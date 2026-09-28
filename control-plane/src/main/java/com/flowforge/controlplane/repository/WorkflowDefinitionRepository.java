package com.flowforge.controlplane.repository;

import com.flowforge.controlplane.domain.WorkflowDefinition;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface WorkflowDefinitionRepository extends JpaRepository<WorkflowDefinition, UUID> {
    Optional<WorkflowDefinition> findTopByNameOrderByVersionDesc(String name);
}
