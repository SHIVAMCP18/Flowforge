package com.flowforge.controlplane.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.controlplane.domain.TaskRun;
import com.flowforge.controlplane.domain.TaskStatus;
import com.flowforge.controlplane.domain.WorkflowDefinition;
import com.flowforge.controlplane.domain.WorkflowRun;
import com.flowforge.controlplane.dto.*;
import com.flowforge.controlplane.repository.TaskRunRepository;
import com.flowforge.controlplane.repository.WorkflowDefinitionRepository;
import com.flowforge.controlplane.repository.WorkflowRunRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class WorkflowService {

    private final WorkflowDefinitionRepository definitionRepo;
    private final WorkflowRunRepository runRepo;
    private final TaskRunRepository taskRunRepo;
    private final DagValidator dagValidator;
    private final SchedulerService schedulerService;
    private final ObjectMapper objectMapper;

    @Value("${flowforge.scheduler.default-task-timeout-seconds}")
    private int defaultTimeoutSeconds;

    @Value("${flowforge.scheduler.default-max-retries}")
    private int defaultMaxRetries;

    public WorkflowService(WorkflowDefinitionRepository definitionRepo,
                            WorkflowRunRepository runRepo,
                            TaskRunRepository taskRunRepo,
                            DagValidator dagValidator,
                            SchedulerService schedulerService,
                            ObjectMapper objectMapper) {
        this.definitionRepo = definitionRepo;
        this.runRepo = runRepo;
        this.taskRunRepo = taskRunRepo;
        this.dagValidator = dagValidator;
        this.schedulerService = schedulerService;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public WorkflowDefinitionResponse registerDefinition(WorkflowDefinitionRequest request) {
        dagValidator.validate(request.getTasks());

        int nextVersion = definitionRepo.findTopByNameOrderByVersionDesc(request.getName())
                .map(d -> d.getVersion() + 1)
                .orElse(1);

        WorkflowDefinition def = new WorkflowDefinition();
        def.setName(request.getName());
        def.setVersion(nextVersion);
        def.setDagJson(writeJson(request.getTasks()));
        def = definitionRepo.save(def);

        return new WorkflowDefinitionResponse(def.getId(), def.getName(), def.getVersion());
    }

    @Transactional
    public WorkflowRunView startRun(UUID definitionId) {
        WorkflowDefinition def = definitionRepo.findById(definitionId)
                .orElseThrow(() -> new NoSuchElementException("Unknown workflow definition: " + definitionId));

        List<TaskSpec> tasks = readTaskSpecs(def.getDagJson());

        WorkflowRun run = new WorkflowRun();
        run.setWorkflowDefinitionId(def.getId());
        run = runRepo.save(run);

        for (TaskSpec spec : tasks) {
            TaskRun taskRun = new TaskRun();
            taskRun.setWorkflowRunId(run.getId());
            taskRun.setTaskName(spec.getName());
            taskRun.setCommand(spec.getCommand());
            taskRun.setDependsOnJson(writeJson(spec.getDependsOn()));
            taskRun.setMaxRetries(spec.getMaxRetries() != null ? spec.getMaxRetries() : defaultMaxRetries);
            taskRun.setTimeoutSeconds(spec.getTimeoutSeconds() != null ? spec.getTimeoutSeconds() : defaultTimeoutSeconds);
            taskRun.setStatus(spec.getDependsOn().isEmpty() ? TaskStatus.READY : TaskStatus.PENDING);
            taskRunRepo.save(taskRun);
        }

        return schedulerService.getRunView(run.getId());
    }

    public WorkflowRunView getRun(UUID runId) {
        return schedulerService.getRunView(runId);
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize workflow payload", e);
        }
    }

    private List<TaskSpec> readTaskSpecs(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<List<TaskSpec>>() {});
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Corrupt DAG definition JSON", e);
        }
    }

    public static class NoSuchElementException extends RuntimeException {
        public NoSuchElementException(String message) { super(message); }
    }
}
