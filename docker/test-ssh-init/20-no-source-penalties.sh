#!/usr/bin/with-contenv bash
# Tests log in wrongly on purpose; OpenSSH 9.8+ would then refuse every connection from the
# host for a while (PerSourcePenalties) and fail unrelated tests running alongside.
grep -q '^PerSourcePenalties' /config/sshd/sshd_config || echo 'PerSourcePenalties no' >> /config/sshd/sshd_config
