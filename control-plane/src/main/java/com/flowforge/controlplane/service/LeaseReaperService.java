package com.flowforge.controlplane.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Background sweep that makes the whole system crash-safe against dead
 * workers: a worker can be killed, OOM'd, or network-partitioned mid-task
 * and it will never leave the DAG stuck. Anything RUNNING past its
 * lease_expires_at is treated exactly like an explicit failure report,
 * feeding the same retry/backoff/cascade logic in SchedulerService.
 */
@Service
public class LeaseReaperService {

    private static final Logger log = LoggerFactory.getLogger(LeaseReaperService.class);

    private final SchedulerService schedulerService;

    public LeaseReaperService(SchedulerService schedulerService) {
        this.schedulerService = schedulerService;
    }

    @Scheduled(fixedDelayString = "${flowforge.scheduler.reaper-interval-ms}")
    public void reapExpiredLeases() {
        int reclaimed = schedulerService.reapExpiredLeases();
        if (reclaimed > 0) {
            log.info("Reaper reclaimed {} expired lease(s)", reclaimed);
        }
    }
}
