package com.flowforge.controlplane.dto;

public class TaskFailureRequest {
    private String errorMessage;

    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
}
