package com.flowforge.controlplane.repository;

import com.flowforge.controlplane.domain.WorkflowRun;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface WorkflowRunRepository extends JpaRepository<WorkflowRun, UUID> {
}
