package com.flowforge.controlplane.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Lets a dashboard hosted on another origin (e.g. Vercel, or `vite dev` on
 * :5173 without the proxy) call the API. Origins come from
 * CORS_ALLOWED_ORIGINS as a comma-separated list.
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final String[] allowedOrigins;

    public CorsConfig(@Value("${flowforge.cors.allowed-origins}") String allowedOrigins) {
        this.allowedOrigins = allowedOrigins.isBlank() ? new String[0] : allowedOrigins.split("\\s*,\\s*");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        if (allowedOrigins.length == 0) return;
        registry.addMapping("/api/**")
                .allowedOriginPatterns(allowedOrigins)
                .allowedMethods("GET", "POST", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }
}
