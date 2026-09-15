#pragma once

namespace pavois {

// Best-effort Linux helpers. They are harmless no-ops on other platforms and
// when the requested CPU does not exist.
bool pin_current_thread(int cpu_index);
double read_cpu_temperature_c();

}  // namespace pavois
