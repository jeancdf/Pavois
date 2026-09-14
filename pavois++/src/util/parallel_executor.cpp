#include "pavois/util/parallel_executor.hpp"

#include <algorithm>

namespace pavois {

ParallelExecutor::ParallelExecutor(int thread_count)
    : thread_count_(std::clamp(thread_count, 1, 8)) {
    workers_.reserve(static_cast<std::size_t>(thread_count_ - 1));
    for (int i = 1; i < thread_count_; ++i) {
        workers_.emplace_back(&ParallelExecutor::worker_loop, this,
                              static_cast<std::size_t>(i));
    }
}

ParallelExecutor::~ParallelExecutor() {
    {
        std::lock_guard<std::mutex> lock(state_mutex_);
        stopping_ = true;
    }
    work_cv_.notify_all();
    for (auto& worker : workers_) {
        if (worker.joinable()) worker.join();
    }
}

std::pair<std::size_t, std::size_t> ParallelExecutor::range_for(
    std::size_t worker_index) const {
    const std::size_t count = end_ - begin_;
    const std::size_t width =
        (count + static_cast<std::size_t>(thread_count_) - 1) /
        static_cast<std::size_t>(thread_count_);
    const std::size_t first =
        std::min(end_, begin_ + worker_index * width);
    return {first, std::min(end_, first + width)};
}

void ParallelExecutor::for_each_range(std::size_t begin, std::size_t end,
                                      const RangeTask& task) {
    if (end <= begin) return;
    if (workers_.empty() || end - begin < static_cast<std::size_t>(thread_count_)) {
        task(begin, end);
        return;
    }

    std::unique_lock<std::mutex> dispatch_lock(dispatch_mutex_);
    {
        std::lock_guard<std::mutex> lock(state_mutex_);
        begin_ = begin;
        end_ = end;
        task_ = task;
        worker_error_ = nullptr;
        finished_workers_ = 0;
        ++generation_;
    }
    work_cv_.notify_all();

    std::exception_ptr caller_error;
    const auto caller_range = range_for(0);
    try {
        task(caller_range.first, caller_range.second);
    } catch (...) {
        caller_error = std::current_exception();
    }

    {
        std::unique_lock<std::mutex> lock(state_mutex_);
        done_cv_.wait(lock, [this] {
            return finished_workers_ == workers_.size();
        });
    }
    if (caller_error) std::rethrow_exception(caller_error);
    if (worker_error_) std::rethrow_exception(worker_error_);
}

void ParallelExecutor::worker_loop(std::size_t worker_index) {
    std::size_t seen_generation = 0;
    for (;;) {
        RangeTask task;
        std::pair<std::size_t, std::size_t> range;
        {
            std::unique_lock<std::mutex> lock(state_mutex_);
            work_cv_.wait(lock, [this, seen_generation] {
                return stopping_ || generation_ != seen_generation;
            });
            if (stopping_) return;
            seen_generation = generation_;
            task = task_;
            range = range_for(worker_index);
        }

        try {
            task(range.first, range.second);
        } catch (...) {
            std::lock_guard<std::mutex> lock(state_mutex_);
            if (!worker_error_) worker_error_ = std::current_exception();
        }

        {
            std::lock_guard<std::mutex> lock(state_mutex_);
            ++finished_workers_;
            if (finished_workers_ == workers_.size()) done_cv_.notify_one();
        }
    }
}

}  // namespace pavois
