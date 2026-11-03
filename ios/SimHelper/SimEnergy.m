// A process's own energy as this Mac's kernel counts it, in nanojoules since the process started. Runs on the Mac:
// a simulator app is one of its processes, and reading the count needs no root.
#import <libproc.h>
#import <stdio.h>
#import <stdlib.h>
#import <sys/resource.h>

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  struct rusage_info_v6 usage;
  if (proc_pid_rusage(atoi(argv[1]), RUSAGE_INFO_V6, (rusage_info_t *)&usage) != 0) {
    perror("proc_pid_rusage");
    return 1;
  }
  printf("{\"energyNj\":%llu}\n", usage.ri_energy_nj);
  return 0;
}
