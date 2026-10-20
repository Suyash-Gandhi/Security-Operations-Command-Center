# Detection, Alerts, Correlation, and Incidents

## 1. Detection philosophy

Detection must be deterministic, explainable, versioned, and testable. The LLM may explain a match but must not decide whether a deterministic rule fired.

## 2. Initial rule types

### Threshold
Example: more than 10 failed authentication events for the same user and source IP in five minutes.

### Sequence
Example: repeated failures followed by a successful authentication within a defined window. Implement after the basic threshold engine is reliable.

### Asset-sensitive condition
Example: a matching activity rule receives a priority adjustment when the target asset is classified as critical. The scoring policy must be explicit.

Do not initially allow arbitrary user-supplied executable code. Define a constrained, validated rule configuration schema.

## 3. Rule definition

A rule should include:
- ID and version.
- Name and description.
- Owner/scope (platform default or organization-owned).
- Rule type.
- Event-type and source filters.
- Grouping key.
- Conditions and time window.
- Severity.
- Enabled state.
- Suppression/deduplication policy.
- Test cases or fixture reference.
- Creator/updater and timestamps.

Changes should create a new version or otherwise preserve the exact rule version used for a historical match.

## 4. Stateful windows

For a threshold rule, define:
- Grouping key (for example organization + user + source IP).
- Window type and duration.
- Whether boundaries are sliding or tumbling.
- Handling of late and duplicate events.
- State expiry.
- Behavior during worker restart.
- Clock-skew policy.

Redis may hold short-lived counters/state, but the design must document what happens if Redis state is lost. For important detections, consider reconstructing state from durable events or persisting match evidence.

## 5. Detection result and alert behavior

A detection match should capture the rule ID/version, time, grouping key, supporting event references, and explanation inputs.

Define alert grouping explicitly. A repeated match may update an existing alert's count and `last_seen_at`, or create a new alert depending on the rule's policy. Do not let retries decide this accidentally.

Alert severity describes the seriousness of the detected behavior. Incident priority describes how urgently it should be investigated. Keep these concepts separate.

## 6. Alert noise controls

Support:
- Deduplication.
- Suppression windows.
- Grouping by rule and relevant entity.
- Repeated-event counters.
- Escalation when conditions change.
- Suppression audit history.
- Clear visibility into how many events contributed to an alert.

Suppression must not hide meaningful escalation or a materially different entity/context. Make suppression rules explicit and testable.

## 7. Correlation

Initial deterministic signals may include:
- Same organization.
- Same user/service account.
- Same asset.
- Same source IP, interpreted carefully.
- Compatible alert categories.
- Close event timestamps.
- Shared session or other strong relation.

Do not correlate solely because two alerts share an IP address; NAT, proxies, VPNs, and shared infrastructure can make that misleading.

When linking an alert to an incident, record the reason or correlation signals. Avoid merging incidents automatically if confidence is insufficient; allow an analyst to link or unlink according to permissions and audit policy.

## 8. Incident lifecycle

Suggested states:
- `NEW`
- `TRIAGED`
- `INVESTIGATING`
- `ESCALATED`
- `CONTAINMENT`
- `RESOLVED`
- `CLOSED`

The state machine may allow non-linear transitions, but allowed transitions must be defined in backend logic. Every transition must check authorization and required fields. High-impact transitions may require a reason.

## 9. Incident priority

Use an explainable configurable score based on factors such as:
- Alert severity.
- Asset criticality.
- Detection confidence, if explicitly defined.
- Number and type of correlated alerts.
- Evidence of repeated or escalating behavior.
- Potential business impact.

Display the contributing factors. Do not label the score as a probability of compromise unless it has been statistically calibrated and validated.

## 10. Incident timeline and evidence

The timeline should distinguish:
- Observed security events.
- Detection matches.
- Alert links.
- Analyst actions.
- Notes.
- Status transitions.
- AI-generated summaries.
- Evidence additions/removals.

Store large evidence files in object storage. Record metadata, checksum, uploader, timestamp, and access history. Validate authorization for every upload, download, and deletion.

## 11. Detection evaluation

Create labeled synthetic scenarios with expected results. Track true positives, false positives, true negatives, false negatives, precision, and recall. State that results apply only to the test dataset and do not prove real-world detection accuracy.

## 12. Required tests

- Threshold boundaries.
- Events exactly on window boundaries.
- Duplicate and late events.
- Rule version change.
- Disabled rule.
- Suppression and escalation.
- Same entity across different tenants.
- Correlation with shared NAT IP.
- Incident transition authorization.
- Concurrent incident updates.
- Alert-to-incident consistency.
- Evidence access and audit behavior.
