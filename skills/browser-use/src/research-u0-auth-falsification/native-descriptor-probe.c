// U0 native-seam probe (research-only, NOT production secret-delivery code).
//
// Models the Confidential Field Delivery Helper's containment contract from
// ADR-0022 without touching real secrets or a real browser:
//   1. Receive a pre-opened connected descriptor over a private inherited
//      channel (socketpair models the private secret-pipe + browser-channel
//      descriptors transferred via XPC fd APIs).
//   2. Read one sentinel value from the inherited descriptor and echo a
//      containment report (models "one bounded field action").
//   3. Attempt to open a NEW outbound network connection -> must be denied
//      when App Sandbox with network.client=false is enforced.
//   4. Attempt to open an UNRELATED file for writing -> must be denied when
//      App Sandbox with no broad-file entitlement is enforced.
//
// The probe reports what it OBSERVES; the harness decides pass/fail. Under an
// ad-hoc signature the sandbox is declared but not OS-enforced, so denials
// will NOT occur — that gap is exactly what the receipt must record as an
// environment/authority blocker rather than an architectural result.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

// The inherited connected descriptor is passed as fd 3 by the parent harness.
#define INHERITED_FD 3

static void emit(const char *key, const char *val) {
	printf("PROBE %s=%s\n", key, val);
}

int main(void) {
	// (2) read one value from the inherited private channel.
	char buf[256];
	ssize_t n = read(INHERITED_FD, buf, sizeof(buf) - 1);
	if (n > 0) {
		buf[n] = '\0';
		// Strip trailing newline for clean reporting.
		if (buf[n - 1] == '\n') buf[n - 1] = '\0';
		emit("inherited_read", "ok");
		emit("inherited_value_len", (n > 0) ? "nonzero" : "zero");
	} else {
		emit("inherited_read", "failed");
	}

	// (3) attempt a NEW outbound network connection (must be denied under
	// enforced App Sandbox with network.client=false).
	int sock = socket(AF_INET, SOCK_STREAM, 0);
	if (sock < 0) {
		emit("new_socket", "denied_at_create");
	} else {
		struct sockaddr_in addr;
		memset(&addr, 0, sizeof(addr));
		addr.sin_family = AF_INET;
		// Port 1 on loopback is expected to refuse immediately when the socket
		// layer is reachable. This avoids external traffic and an unbounded
		// connect while preserving EPERM/EACCES as the sandbox-denial signal.
		addr.sin_port = htons(1);
		addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
		int rc = connect(sock, (struct sockaddr *)&addr, sizeof(addr));
		if (rc == 0) {
			emit("new_network_connect", "ALLOWED"); // containment failure signal
		} else if (errno == EPERM || errno == EACCES) {
			emit("new_network_connect", "denied_sandbox");
		} else {
			// Reached the socket layer (not sandbox-blocked) but connect failed
			// for network reasons; record honestly.
			emit("new_network_connect", "reached_network_layer");
		}
		close(sock);
	}

	// (4) attempt to open an UNRELATED file for writing (must be denied under
	// enforced App Sandbox with no broad-file entitlement).
	const char *unrelated = "/tmp/u0-unrelated-file-probe.txt";
	int fd = open(unrelated, O_WRONLY | O_CREAT | O_TRUNC, 0600);
	if (fd >= 0) {
		emit("unrelated_file_open", "ALLOWED"); // containment failure signal
		close(fd);
		unlink(unrelated);
	} else if (errno == EPERM || errno == EACCES) {
		emit("unrelated_file_open", "denied_sandbox");
	} else {
		char msg[128];
		snprintf(msg, sizeof(msg), "errno_%d", errno);
		emit("unrelated_file_open", msg);
	}

	emit("bounded_action", "exited_after_one");
	return 0;
}
