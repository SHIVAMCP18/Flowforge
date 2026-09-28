package com.flowforge.controlplane.repository;

import com.flowforge.controlplane.domain.WorkflowRun;
import com.flowforge.controlplane.domain.WorkflowRunStatus;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface WorkflowRunRepository extends JpaRepository<WorkflowRun, UUID> {

    @Query("""
            SELECT r FROM WorkflowRun r
            WHERE (:status IS NULL OR r.status = :status)
              AND (:definitionId IS NULL OR r.workflowDefinitionId = :definitionId)
            ORDER BY r.createdAt DESC
            """)
    List<WorkflowRun> findRecent(@Param("status") WorkflowRunStatus status,
                                 @Param("definitionId") UUID definitionId,
                                 Pageable pageable);
}
