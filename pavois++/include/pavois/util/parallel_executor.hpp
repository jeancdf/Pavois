#pragma once

#include <condition_variable>
#include <cstddef>
#include <exception>
#include <functional>
#include <mutex>
#include <thread>
#include <utility>
#include <vector>

namespace pavois {

// Small persistent executor for the per-frame image passes. The calling
// camera thread participates in every job, so `thread_count` is the total
// processing width rather than the number of background helpers.
class ParallelExecutor {
public:
    using RangeTask = std::function<void(std::size_t, std::size_t)>;

    explicit ParallelExecutor(int thread_count, int first_worker_cpu = -1);
    ~ParallelExecutor();

    ParallelExecutor(const ParallelExecutor&) = delete;
    ParallelExecutor& operator=(const ParallelExecutor&) = delete;

    int thread_count() const { return thread_count_; }
    void for_each_range(std::size_t begin, std::size_t end,
                        const RangeTask& task);

private:
    void worker_loop(std::size_t worker_index);
    std::pair<std::size_t, std::size_t> range_for(
        std::size_t worker_index) const;

    int thread_count_ = 1;
    int first_worker_cpu_ = -1;
    std::vector<std::thread> workers_;

    // Only one image pass uses this compact executor at a time. A process-wide
    // instance can still be shared safely by several CameraWorkers.
    std::mutex dispatch_mutex_;
    std::mutex state_mutex_;
    std::condition_variable work_cv_;
    std::condition_variable done_cv_;
    bool stopping_ = false;
    std::size_t generation_ = 0;
    std::size_t finished_workers_ = 0;
    std::size_t begin_ = 0;
    std::size_t end_ = 0;
    RangeTask task_;
    std::exception_ptr worker_error_;
};

}  // namespace pavois
