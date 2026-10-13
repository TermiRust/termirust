#!/usr/bin/with-contenv bash
# Lets the jump-host integration tests open direct-tcpip channels through this server.
sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /config/sshd/sshd_config
