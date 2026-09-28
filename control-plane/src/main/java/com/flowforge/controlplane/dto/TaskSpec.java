package com.flowforge.controlplane.dto;

import java.util.List;

/** One node in a workflow DAG definition, as submitted by a client. */
public class TaskSpec {
    private String name;
    private List<String> dependsOn = List.of();
    private String command;
    private Integer timeoutSeconds;
    private Integer maxRetries;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public List<String> getDependsOn() { return dependsOn; }
    public void setDependsOn(List<String> dependsOn) { this.dependsOn = dependsOn; }
    public String getCommand() { return command; }
    public void setCommand(String command) { this.command = command; }
    public Integer getTimeoutSeconds() { return timeoutSeconds; }
    public void setTimeoutSeconds(Integer timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
    public Integer getMaxRetries() { return maxRetries; }
    public void setMaxRetries(Integer maxRetries) { this.maxRetries = maxRetries; }
}
