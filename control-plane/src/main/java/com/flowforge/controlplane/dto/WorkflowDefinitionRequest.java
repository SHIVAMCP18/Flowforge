package com.flowforge.controlplane.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public class WorkflowDefinitionRequest {
    @NotBlank
    private String name;
    @NotEmpty
    private List<TaskSpec> tasks;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public List<TaskSpec> getTasks() { return tasks; }
    public void setTasks(List<TaskSpec> tasks) { this.tasks = tasks; }
}
