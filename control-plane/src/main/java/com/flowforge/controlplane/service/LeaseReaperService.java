package com.flowforge.controlplane.service;

import com.flowforge.controlplane.domain.TaskRun;
import com.flowforge.controlplane.repository.TaskRunRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

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

    private final TaskRunRepository taskRunRepo;
    private final SchedulerService schedulerService;

    public LeaseReaperService(TaskRunRepository taskRunRepo, SchedulerService schedulerService) {
        this.taskRunRepo = taskRunRepo;
        this.schedulerService = schedulerService;
    }

    @Scheduled(fixedDelayString = "${flowforge.scheduler.reaper-interval-ms}")
    public void reapExpiredLeases() {
        List<TaskRun> expired = taskRunRepo.findExpiredLeases(Instant.now());
        for (TaskRun task : expired) {
            log.warn("Reclaiming expired lease: task={} run={} worker={}",
                    task.getTaskName(), task.getWorkflowRunId(), task.getWorkerId());
            schedulerService.reclaimExpiredLease(task);
        }
    }
}
