package com.flowforge.controlplane.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.flowforge.controlplane.domain.TaskRun;
import com.flowforge.controlplane.domain.TaskStatus;
import com.flowforge.controlplane.domain.WorkflowDefinition;
import com.flowforge.controlplane.domain.WorkflowRun;
import com.flowforge.controlplane.domain.WorkflowRunStatus;
import com.flowforge.controlplane.dto.*;
import com.flowforge.controlplane.repository.TaskRunRepository;
import com.flowforge.controlplane.repository.WorkflowDefinitionRepository;
import com.flowforge.controlplane.repository.WorkflowRunRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class WorkflowService {

    private static final int MAX_RUN_PAGE = 200;

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

    /** Dry-run validation: checks the DAG and returns its execution plan without persisting anything. */
    public DagValidationResponse validate(WorkflowDefinitionRequest request) {
        return dagValidator.validate(request.getTasks());
    }

    @Transactional(readOnly = true)
    public List<WorkflowDefinitionView> listDefinitions() {
        return definitionRepo.findAllByOrderByCreatedAtDesc().stream().map(this::toView).toList();
    }

    @Transactional(readOnly = true)
    public WorkflowDefinitionView getDefinition(UUID definitionId) {
        return toView(requireDefinition(definitionId));
    }

    @Transactional
    public WorkflowRunView startRun(UUID definitionId) {
        WorkflowDefinition def = requireDefinition(definitionId);
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

    @Transactional(readOnly = true)
    public WorkflowRunView getRun(UUID runId) {
        return schedulerService.getRunView(runId);
    }

    /** Most recent runs first, optionally filtered by status and/or definition. */
    @Transactional(readOnly = true)
    public List<WorkflowRunSummary> listRuns(String status, UUID definitionId, int limit) {
        WorkflowRunStatus statusFilter = null;
        if (status != null && !status.isBlank()) {
            try {
                statusFilter = WorkflowRunStatus.valueOf(status.trim().toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("Unknown run status '" + status + "'. Expected one of "
                        + Arrays.toString(WorkflowRunStatus.values()));
            }
        }
        int pageSize = Math.max(1, Math.min(limit, MAX_RUN_PAGE));
        List<WorkflowRun> runs = runRepo.findRecent(statusFilter, definitionId, PageRequest.of(0, pageSize));
        if (runs.isEmpty()) return List.of();

        Set<UUID> runIds = runs.stream().map(WorkflowRun::getId).collect(Collectors.toSet());
        Map<UUID, Map<String, Long>> counts = new HashMap<>();
        for (TaskRunRepository.StatusCount c : taskRunRepo.countByRunAndStatus(runIds)) {
            counts.computeIfAbsent(c.getRunId(), k -> new TreeMap<>()).put(c.getStatus().name(), c.getTotal());
        }

        Set<UUID> definitionIds = runs.stream().map(WorkflowRun::getWorkflowDefinitionId).collect(Collectors.toSet());
        Map<UUID, WorkflowDefinition> definitions = definitionRepo.findAllById(definitionIds).stream()
                .collect(Collectors.toMap(WorkflowDefinition::getId, Function.identity()));

        return runs.stream().map(run -> {
            Map<String, Long> taskCounts = counts.getOrDefault(run.getId(), Map.of());
            WorkflowDefinition def = definitions.get(run.getWorkflowDefinitionId());
            int total = (int) taskCounts.values().stream().mapToLong(Long::longValue).sum();
            return new WorkflowRunSummary(run.getId(), run.getWorkflowDefinitionId(),
                    def != null ? def.getName() : null, def != null ? def.getVersion() : 0,
                    run.getStatus().name(), run.getStartedAt(), run.getCompletedAt(), total, taskCounts);
        }).toList();
    }

    private WorkflowDefinition requireDefinition(UUID definitionId) {
        return definitionRepo.findById(definitionId)
                .orElseThrow(() -> new NoSuchElementException("Unknown workflow definition: " + definitionId));
    }

    private WorkflowDefinitionView toView(WorkflowDefinition def) {
        return new WorkflowDefinitionView(def.getId(), def.getName(), def.getVersion(), def.getCreatedAt(),
                readTaskSpecs(def.getDagJson()));
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
