#include "pavois/util/thread_tuning.hpp"

#include <fstream>

#if defined(__linux__)
#include <pthread.h>
#include <sched.h>
#include <unistd.h>
#endif

namespace pavois {

bool pin_current_thread(int cpu_index) {
#if defined(__linux__)
    const long count = ::sysconf(_SC_NPROCESSORS_ONLN);
    if (cpu_index < 0 || count <= cpu_index) return false;
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(cpu_index, &set);
    return ::pthread_setaffinity_np(::pthread_self(), sizeof(set), &set) == 0;
#else
    (void)cpu_index;
    return false;
#endif
}

double read_cpu_temperature_c() {
#if defined(__linux__)
    std::ifstream input("/sys/class/thermal/thermal_zone0/temp");
    double millidegrees = 0.0;
    if (input >> millidegrees) return millidegrees / 1000.0;
#endif
    return -1.0;
}

}  // namespace pavois
