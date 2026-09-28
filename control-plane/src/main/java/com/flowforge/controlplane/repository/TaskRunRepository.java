package com.flowforge.controlplane.repository;

import com.flowforge.controlplane.domain.TaskRun;
import com.flowforge.controlplane.domain.TaskStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TaskRunRepository extends JpaRepository<TaskRun, UUID> {

    List<TaskRun> findByWorkflowRunId(UUID workflowRunId);

    List<TaskRun> findByWorkflowRunIdAndStatus(UUID workflowRunId, TaskStatus status);

    /**
     * The scheduler's core primitive: atomically claim one READY task so that
     * concurrent workers (and concurrent control-plane instances) never race
     * on the same task. SKIP LOCKED means a busy row is simply passed over
     * instead of blocking the caller — this is what lets the lease endpoint
     * stay fast under many concurrent worker pollers. The row lock is taken
     * explicitly by the raw SQL (FOR UPDATE SKIP LOCKED) rather than via
     * @Lock, since JPA lock modes aren't applied to native queries.
     */
    @Query(value = """
            SELECT * FROM task_runs
            WHERE status = 'READY' AND next_attempt_at <= :now
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """, nativeQuery = true)
    Optional<TaskRun> claimNextReadyTask(@Param("now") Instant now);

    @Query("SELECT t FROM TaskRun t WHERE t.status = 'RUNNING' AND t.leaseExpiresAt < :now")
    List<TaskRun> findExpiredLeases(@Param("now") Instant now);
}
