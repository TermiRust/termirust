//! A quick health snapshot of a server for the Monitor screen, gathered on its own exec
//! channel so nothing shows in the user's terminals.

use std::time::Duration;

use super::shell_session::SshConnection;
use crate::Result;

/// Plain POSIX sh reading /proc; sections are marked so missing tools only blank one field.
const PROBE: &str = r#"export LC_ALL=C
echo '@@os'; grep -E '^(ID|PRETTY_NAME)=' /etc/os-release 2>/dev/null
echo '@@kernel'; uname -srm 2>/dev/null
echo '@@hostname'; hostname 2>/dev/null
echo '@@uptime'; cat /proc/uptime 2>/dev/null
echo '@@load'; cat /proc/loadavg 2>/dev/null
echo '@@cpus'; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null
echo '@@stat1'; head -1 /proc/stat 2>/dev/null
sleep 0.5
echo '@@stat2'; head -1 /proc/stat 2>/dev/null
echo '@@mem'; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null
echo '@@disk'; df -kP / 2>/dev/null | tail -1
echo '@@ip'; hostname -I 2>/dev/null || ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}'
echo '@@procs'; ps -eo pcpu,pmem,comm --sort=-pcpu 2>/dev/null | sed -n '2,6p'
echo '@@end'"#;

#[derive(Debug, Clone, PartialEq)]
pub struct TopProcess {
    pub cpu_percent: f64,
    pub mem_percent: f64,
    pub command: String,
}

/// Everything is optional: a field the server could not report stays empty.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HostStats {
    pub os_id: Option<String>,
    pub os_name: Option<String>,
    pub kernel: Option<String>,
    pub hostname: Option<String>,
    pub uptime_secs: Option<u64>,
    pub load: Option<[f64; 3]>,
    pub cpu_count: Option<u32>,
    pub cpu_percent: Option<f64>,
    pub mem_total_kb: Option<u64>,
    pub mem_available_kb: Option<u64>,
    pub swap_total_kb: Option<u64>,
    pub swap_free_kb: Option<u64>,
    pub disk_total_kb: Option<u64>,
    pub disk_used_kb: Option<u64>,
    pub disk_mount: Option<String>,
    pub addresses: Vec<String>,
    pub top_processes: Vec<TopProcess>,
}

fn sections(output: &str) -> std::collections::HashMap<&str, Vec<&str>> {
    let mut map = std::collections::HashMap::new();
    let mut current: Option<&str> = None;
    for line in output.lines() {
        if let Some(name) = line.strip_prefix("@@") {
            current = Some(name.trim());
            map.entry(name.trim()).or_insert_with(Vec::new);
        } else if let Some(name) = current {
            map.entry(name)
                .or_insert_with(Vec::new)
                .push(line.trim_end());
        }
    }
    map
}

/// (busy, total) jiffies from a "cpu ..." line of /proc/stat.
fn cpu_times(line: &str) -> Option<(u64, u64)> {
    let fields: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .filter_map(|f| f.parse().ok())
        .collect();
    if fields.len() < 4 {
        return None;
    }
    let total: u64 = fields.iter().take(8).sum();
    let idle = fields[3] + fields.get(4).copied().unwrap_or(0);
    Some((total - idle, total))
}

fn meminfo(lines: &[&str], key: &str) -> Option<u64> {
    lines.iter().find_map(|l| {
        l.strip_prefix(key)?
            .strip_prefix(':')?
            .split_whitespace()
            .next()?
            .parse()
            .ok()
    })
}

pub fn parse_stats(output: &str) -> HostStats {
    let s = sections(output);
    let first = |name: &str| {
        s.get(name)
            .and_then(|l| l.iter().find(|x| !x.trim().is_empty()))
            .map(|x| x.trim().to_owned())
    };
    let os_field = |key: &str| {
        s.get("os")?.iter().find_map(|l| {
            l.strip_prefix(key)?
                .strip_prefix('=')
                .map(|v| v.trim_matches('"').to_owned())
        })
    };

    let cpu_percent = match (
        first("stat1").and_then(|l| cpu_times(&l)),
        first("stat2").and_then(|l| cpu_times(&l)),
    ) {
        (Some((b1, t1)), Some((b2, t2))) if t2 > t1 => {
            Some(((b2.saturating_sub(b1)) as f64 / (t2 - t1) as f64 * 100.0).clamp(0.0, 100.0))
        }
        _ => None,
    };
    let load = first("load").and_then(|l| {
        let v: Vec<f64> = l
            .split_whitespace()
            .take(3)
            .filter_map(|x| x.parse().ok())
            .collect();
        (v.len() == 3).then(|| [v[0], v[1], v[2]])
    });
    let mem = s.get("mem").cloned().unwrap_or_default();
    let (disk_total_kb, disk_used_kb, disk_mount) = first("disk")
        .map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            (
                f.get(1).and_then(|x| x.parse().ok()),
                f.get(2).and_then(|x| x.parse().ok()),
                f.get(5).map(|m| (*m).to_owned()),
            )
        })
        .unwrap_or((None, None, None));
    let addresses = s
        .get("ip")
        .map(|lines| {
            lines
                .iter()
                .flat_map(|l| l.split_whitespace())
                .map(|a| a.split('/').next().unwrap_or(a).to_owned())
                .filter(|a| !a.is_empty() && !a.starts_with("127.") && a != "::1")
                .take(4)
                .collect()
        })
        .unwrap_or_default();
    let top_processes = s
        .get("procs")
        .map(|lines| {
            lines
                .iter()
                .filter_map(|l| {
                    let mut f = l.split_whitespace();
                    let cpu = f.next()?.parse().ok()?;
                    let mem = f.next()?.parse().ok()?;
                    let command = f.collect::<Vec<_>>().join(" ");
                    (!command.is_empty()).then_some(TopProcess {
                        cpu_percent: cpu,
                        mem_percent: mem,
                        command,
                    })
                })
                .take(5)
                .collect()
        })
        .unwrap_or_default();

    HostStats {
        os_id: os_field("ID"),
        os_name: os_field("PRETTY_NAME"),
        kernel: first("kernel"),
        hostname: first("hostname"),
        uptime_secs: first("uptime")
            .and_then(|l| l.split_whitespace().next()?.parse::<f64>().ok())
            .map(|v| v as u64),
        load,
        cpu_count: first("cpus").and_then(|l| l.parse().ok()),
        cpu_percent,
        mem_total_kb: meminfo(&mem, "MemTotal"),
        mem_available_kb: meminfo(&mem, "MemAvailable"),
        swap_total_kb: meminfo(&mem, "SwapTotal"),
        swap_free_kb: meminfo(&mem, "SwapFree"),
        disk_total_kb,
        disk_used_kb,
        disk_mount,
        addresses,
        top_processes,
    }
}

impl SshConnection {
    /// Takes about half a second (two CPU samples).
    pub async fn host_stats(&self) -> Result<HostStats> {
        let output = self.exec_capture(PROBE, Duration::from_secs(8)).await?;
        Ok(parse_stats(&output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UBUNTU: &str = "@@os
ID=ubuntu
PRETTY_NAME=\"Ubuntu 24.04.1 LTS\"
@@kernel
Linux 6.8.0-45-generic x86_64
@@hostname
web-1
@@uptime
356400.52 1400000.10
@@load
0.42 0.31 0.25 2/321 12345
@@cpus
4
@@stat1
cpu  1000 0 500 8000 500 0 0 0 0 0
@@stat2
cpu  1100 0 550 8300 550 0 0 0 0 0
@@mem
MemTotal:        8000000 kB
MemAvailable:    2000000 kB
SwapTotal:       1048576 kB
SwapFree:         524288 kB
@@disk
/dev/sda1 51475068 20590024 28247708  43% /
@@ip
10.0.1.12 172.17.0.1 fe80::1
@@procs
 12.5  3.1 postgres
  2.0  1.0 nginx: worker process
@@end";

    #[test]
    fn reads_a_linux_snapshot() {
        let s = parse_stats(UBUNTU);
        assert_eq!(s.os_id.as_deref(), Some("ubuntu"));
        assert_eq!(s.os_name.as_deref(), Some("Ubuntu 24.04.1 LTS"));
        assert_eq!(s.kernel.as_deref(), Some("Linux 6.8.0-45-generic x86_64"));
        assert_eq!(s.hostname.as_deref(), Some("web-1"));
        assert_eq!(s.uptime_secs, Some(356_400));
        assert_eq!(s.load, Some([0.42, 0.31, 0.25]));
        assert_eq!(s.cpu_count, Some(4));
        // busy +150 of total +500 jiffies
        assert!((s.cpu_percent.unwrap() - 30.0).abs() < 0.01);
        assert_eq!(
            (s.mem_total_kb, s.mem_available_kb),
            (Some(8_000_000), Some(2_000_000))
        );
        assert_eq!(
            (s.swap_total_kb, s.swap_free_kb),
            (Some(1_048_576), Some(524_288))
        );
        assert_eq!(
            (s.disk_total_kb, s.disk_used_kb, s.disk_mount.as_deref()),
            (Some(51_475_068), Some(20_590_024), Some("/"))
        );
        assert_eq!(s.addresses, ["10.0.1.12", "172.17.0.1", "fe80::1"]);
        assert_eq!(
            s.top_processes[0],
            TopProcess {
                cpu_percent: 12.5,
                mem_percent: 3.1,
                command: "postgres".into()
            }
        );
        assert_eq!(s.top_processes[1].command, "nginx: worker process");
    }

    #[test]
    fn leaves_fields_empty_when_the_server_cannot_report_them() {
        let s = parse_stats(
            "@@os\n@@kernel\nDarwin 23.0.0 arm64\n@@uptime\n@@stat1\n@@stat2\n@@mem\n@@disk\n@@ip\n127.0.0.1/8\n@@procs\n@@end",
        );
        assert_eq!(s.kernel.as_deref(), Some("Darwin 23.0.0 arm64"));
        assert_eq!((s.cpu_percent, s.mem_total_kb, s.load), (None, None, None));
        assert!(s.addresses.is_empty(), "loopback is not shown");
        assert!(s.top_processes.is_empty());
    }
}
