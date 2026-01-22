# Future Plan: Machine Learning Integration

This file outlines a future ML integration plan for Sentinel without changing current
production paths. The goal is to add ML-based anomaly detection and correlation in a
safe, incremental way while keeping existing rule-based behavior as the default.

## Goals

- Improve detection of unknown failure modes (noisy or novel patterns).
- Reduce alert fatigue by suppressing low-signal events.
- Correlate multi-source events into the same incident automatically.
- Keep explainability and safe rollback via rule-based fallbacks.

## Non-Goals (for initial ML phase)

- Replacing the incident engine rules entirely.
- Fully automated incident resolution.
- Real-time model training in production.

## Proposed Integration Approach

### 1) Add an ML Scoring Service (Side-Channel)

- New service: `services/ml-scorer` (Lambda or container) that accepts events and
  outputs a score and optional correlation key.
- Output is added as a non-breaking field, for example:
  - `mlSeverityScore: number` (0-1)
  - `mlSeverityClass: low|medium|high|critical`
  - `mlCorrelationKey: string`
  - `mlAnomaly: boolean`

### 2) Event Flow

Current flow (unchanged):
- Ingest -> EventBridge -> SQS -> Incident Engine

ML addition (side-channel):
- Ingest -> EventBridge -> ML Scorer -> EventBridge (enriched events)
- Incident Engine optionally reads ML fields when present.

This keeps the current logic intact and allows a phased rollout.

### 3) Changes in Incident Engine (Gated)

- Feature-flag behavior via environment variable (for example `ML_ENABLED=false`).
- If enabled, use `mlSeverityClass` to influence severity only when it exceeds
  rule-based severity, and log the difference for evaluation.
- If `mlCorrelationKey` exists, allow it to override fingerprint-based correlation
  only when confidence > threshold.

## Data Requirements

### 1) Event Data Lake

- Export ingested events to S3 using EventBridge Archive or Firehose.
- Store schema version with each record to keep compatibility.
- Retain at least 30-90 days for initial modeling.

### 2) Labels and Feedback

- Use incident outcomes as weak labels:
  - Severity levels after incident resolution
  - Human ack/resolve timestamps
  - Escalations
- Add optional operator feedback endpoint to mark false positives/negatives.

## Model Options

### Phase 1: Unsupervised Anomaly Detection

- Isolation Forest, One-Class SVM, or robust z-score per signal.
- Quick to deploy and useful when labeled data is limited.

### Phase 2: Supervised Severity Classification

- Gradient boosted trees (XGBoost/LightGBM) on aggregated features.
- Requires incident labels and better feature engineering.

### Phase 3: Correlation / Clustering

- Embedding-based similarity on fingerprints + attributes.
- Approximate nearest neighbors for grouping related events.

## Feature Engineering (Initial)

- Counts over rolling windows per source and fingerprint.
- Error rate deltas vs baseline (per service/env/region).
- Attribute presence (e.g., errorCode, region, userId).
- Temporal features (hour of day, day of week).

## Training Pipeline

- Batch training in a separate repo or `jobs/` folder.
- Store features in parquet in S3.
- Train on a schedule (daily/weekly) and register models.
- Push model artifacts to S3 with versioning.

## Serving and Runtime

### Option A: Lambda-based Inference

- Load model artifact from S3 on cold start.
- Suitable for smaller models and low latency constraints.
- Keep inference under 100-200 ms.

### Option B: SageMaker Endpoint

- For heavier models or GPU requirements.
- Higher cost but predictable scaling.
- Add timeout and circuit breakers in scorer.

## Rollout Strategy

1. Shadow mode: ML scorer runs but does not affect incident flow.
2. Metrics-only: log ML predictions vs actual incident outcomes.
3. Feature-flagged influence: allow ML to only escalate severity.
4. Controlled ramp: enable per source or env.

## Observability and Evaluation

- Track precision/recall on incident escalation decisions.
- Track correlation accuracy (manual review of grouped incidents).
- Add metrics: `ml_events_scored`, `ml_anomalies_detected`,
  `ml_severity_overrides`.

## Risk Mitigations

- Hard fallback: rules always take priority if ML fails.
- Confidence thresholds prevent aggressive changes.
- Rate-limit ML scorer to avoid backpressure.
- Strict schema versioning for ML features.

## IaC Additions (Future)

- New Lambda + EventBridge rule for ML scoring.
- Optional S3 bucket for training data and model artifacts.
- IAM roles for S3 access and model read.

## Suggested Milestones

- M1: Data export to S3 + shadow scoring
- M2: Metrics dashboard + offline evaluation
- M3: Optional severity escalation in limited scope
- M4: Correlation suggestions with operator feedback
