#include <fcntl.h>

int browser_use_openat_exclusive(
    int directory,
    const char *name,
    int flags,
    int mode
) {
    return openat(directory, name, flags, mode);
}
