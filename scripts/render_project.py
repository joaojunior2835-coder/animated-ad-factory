#!/usr/bin/env python3
"""Deterministic Flow project renderer.

Reads a project JSON file, validates the required fields manually (no third-party
dependencies), and writes a clean Markdown export to exports/<slug>-flow-export.md.

The output contract lives in docs/output-spec.md. The schema lives in
schema/project.schema.json. Standard library only.

Usage:
    python scripts/render_project.py examples/example-50s-project.json
"""

import json
import os
import re
import sys

# Per-clip fields that must be present and a non-empty string.
SCENE_STRING_FIELDS = [
    "purpose",
    "start_frame_prompt",
    "end_frame_prompt",
    "flow_agent_prompt",
    "camera_movement",
    "subject_motion",
    "environment_motion",
]

# Per-clip fields that must be a non-empty list.
SCENE_LIST_FIELDS = [
    "continuity_references",
    "negative_constraints",
]

DEFAULT_CHECKLIST = [
    "Does the product remain visually identical across every clip?",
    "Does the subject remain visually identical across every clip?",
    "Does the lighting stay coherent from clip to clip?",
    "Does each clip have only one primary action?",
    "Does each end frame bridge cleanly into the next clip?",
    "Are all prompts copy-paste clean with no leftover template variables?",
]


def slugify(title):
    s = re.sub(r"[^a-z0-9]+", "-", title.lower().strip())
    return s.strip("-") or "project"


def titleize(key):
    return key.replace("_", " ").title()


def fmt_inline(value):
    if isinstance(value, list):
        return ", ".join(str(x) for x in value)
    return str(value)


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def fmt_num(value):
    if is_number(value) and float(value).is_integer():
        return int(value)
    return value


# Generic words that carry no continuity signal, so the Bridge Check ignores them.
BRIDGE_STOPWORDS = set(
    """same still this that these those with from into onto over under while
    only just very more most into toward towards across along then than them
    they their there here what when where which whom whose your yours ours
    have been being does done such each both either neither about above below
    scene clip frame shot start end begins begin still remains remain into""".split()
)


def keywords(text):
    """Lowercase content words of length >= 4 that are not stopwords."""
    words = re.findall(r"[a-z0-9]+", str(text).lower())
    return {w for w in words if len(w) >= 4 and w not in BRIDGE_STOPWORDS}


def keywords_of(items):
    kw = set()
    for item in items:
        kw |= keywords(item)
    return kw


def validate(data):
    """Return a list of human-readable error strings. Empty list means valid."""
    errors = []
    if not isinstance(data, dict):
        return ["Root JSON must be an object."]

    project = data.get("project")
    if not isinstance(project, dict):
        errors.append("project is required and must be an object.")
    else:
        title = project.get("title")
        if not isinstance(title, str) or not title.strip():
            errors.append("project.title is required and must be a non-empty string.")
        runtime = project.get("target_runtime_seconds")
        if not isinstance(runtime, (int, float)) or isinstance(runtime, bool):
            errors.append("project.target_runtime_seconds is required and must be a number.")
        platform = project.get("platform")
        if not isinstance(platform, str) or not platform.strip():
            errors.append("project.platform is required and must be a non-empty string.")

    cb = data.get("continuity_bible")
    if not isinstance(cb, dict) or not cb:
        errors.append("continuity_bible is required and must be a non-empty object.")

    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        errors.append("scenes is required and must be a non-empty array.")
    else:
        for i, scene in enumerate(scenes):
            prefix = "scenes[%d]" % i
            if not isinstance(scene, dict):
                errors.append("%s must be an object." % prefix)
                continue
            num = scene.get("scene_number")
            if not isinstance(num, int) or isinstance(num, bool):
                errors.append("%s.scene_number is required and must be an integer." % prefix)
            dur = scene.get("duration_seconds")
            if not isinstance(dur, (int, float)) or isinstance(dur, bool):
                errors.append("%s.duration_seconds is required and must be a number." % prefix)
            for field in SCENE_STRING_FIELDS:
                v = scene.get(field)
                if not isinstance(v, str) or not v.strip():
                    errors.append("%s.%s is required and must be a non-empty string." % (prefix, field))
            for field in SCENE_LIST_FIELDS:
                v = scene.get(field)
                if not isinstance(v, list) or not v:
                    errors.append("%s.%s is required and must be a non-empty array." % (prefix, field))

    # Duration math: declared total must equal the sum of clip durations.
    # Only checked when the relevant numbers are all present and valid, so this
    # adds a distinct error rather than duplicating the type errors above.
    if isinstance(project, dict) and isinstance(scenes, list) and scenes:
        runtime = project.get("target_runtime_seconds")
        scene_objs = [s for s in scenes if isinstance(s, dict)]
        durations = [s.get("duration_seconds") for s in scene_objs]
        if is_number(runtime) and scene_objs and all(is_number(d) for d in durations):
            total = sum(durations)
            if total != runtime:
                diff = total - runtime
                sign = "+" if diff >= 0 else "-"
                errors.append(
                    "Duration mismatch: declared total (project.target_runtime_seconds) is "
                    "%s seconds, but the %d clip durations sum to %s seconds "
                    "(difference %s%s seconds). Fix the clip durations or the declared total; "
                    "no export is written until they match."
                    % (fmt_num(runtime), len(durations), fmt_num(total), sign, fmt_num(abs(diff)))
                )

    return errors


def render_continuity(cb):
    lines = []
    for key, value in cb.items():
        lines.append("### %s" % titleize(key))
        lines.append("")
        if isinstance(value, dict):
            for k, v in value.items():
                lines.append("- **%s:** %s" % (titleize(k), fmt_inline(v)))
        elif isinstance(value, list):
            for item in value:
                lines.append("- %s" % item)
        else:
            lines.append("- %s" % value)
        lines.append("")
    return "\n".join(lines)


def render(data):
    project = data["project"]
    scenes = data["scenes"]
    cb = data["continuity_bible"]
    title = project["title"]

    out = []
    out.append("# %s — Flow Export" % title)
    out.append("")
    out.append("> Generated by `scripts/render_project.py`. Do not edit by hand; re-render from the project JSON.")
    out.append("")

    # Project Overview
    out.append("## Project Overview")
    out.append("")
    out.append("- **Title:** %s" % title)
    out.append("- **Total runtime:** %s seconds" % project["target_runtime_seconds"])
    out.append("- **Platform:** %s" % project["platform"])
    for opt_key, label in [
        ("aspect_ratio", "Aspect ratio"),
        ("visual_style", "Visual style"),
        ("goal", "Goal"),
        ("scene_duration_rule", "Clip duration rule"),
    ]:
        if project.get(opt_key):
            out.append("- **%s:** %s" % (label, project[opt_key]))
    out.append("- **Clip count:** %d" % len(scenes))
    total = sum(s.get("duration_seconds", 0) for s in scenes)
    out.append("- **Sum of clip durations:** %s seconds" % total)
    out.append("")

    # Continuity Bible
    out.append("## Continuity Bible")
    out.append("")
    out.append(render_continuity(cb))

    # Clip-by-Clip Plan
    out.append("## Clip-by-Clip Plan")
    out.append("")
    out.append("| Clip | Duration | Purpose |")
    out.append("| --- | --- | --- |")
    for s in scenes:
        purpose = str(s["purpose"]).replace("|", "\\|")
        out.append("| %s | %ss | %s |" % (s["scene_number"], s["duration_seconds"], purpose))
    out.append("")

    # Clips (detailed)
    out.append("## Clips")
    out.append("")
    for idx, s in enumerate(scenes):
        out.append("### Clip %s — %s (%ss)" % (s["scene_number"], s["purpose"], s["duration_seconds"]))
        out.append("")
        if s.get("start_state"):
            out.append("- **Start state:** %s" % s["start_state"])
        if s.get("end_state"):
            out.append("- **End state:** %s" % s["end_state"])
        out.append("- **Camera movement:** %s" % s["camera_movement"])
        out.append("- **Subject motion:** %s" % s["subject_motion"])
        out.append("- **Environment motion:** %s" % s["environment_motion"])
        out.append("")
        for label, field in [
            ("Start-Frame Prompt", "start_frame_prompt"),
            ("End-Frame Prompt", "end_frame_prompt"),
        ]:
            out.append("**%s**" % label)
            out.append("")
            out.append("```text")
            out.append(str(s[field]).strip())
            out.append("```")
            out.append("")
        out.append("**Flow Agent Mode Prompt**")
        out.append("")
        out.append("Attach:")
        out.append("- Scene %s start frame image" % s["scene_number"])
        out.append("- Scene %s end frame image" % s["scene_number"])
        out.append("")
        out.append("```text")
        out.append(str(s["flow_agent_prompt"]).strip())
        out.append("```")
        out.append("")
        out.append("- **Continuity references:** %s" % fmt_inline(s["continuity_references"]))
        out.append("- **Negative constraints:** %s" % fmt_inline(s["negative_constraints"]))
        out.append("")

        # Bridge Check: review aid for the handoff into the next clip. Skipped
        # for the final clip. Connection/risk are heuristic signals derived from
        # the text, not a visual verdict — confirm against the actual frames.
        if idx < len(scenes) - 1:
            nxt = scenes[idx + 1]
            end_kw = keywords(s.get("end_state", ""))
            next_start = nxt.get("start_state", "")
            shared = sorted(end_kw & keywords(next_start))
            cur_anchor_kw = end_kw | keywords_of(s.get("continuity_references", []))
            unanchored = [
                ref for ref in nxt.get("continuity_references", [])
                if not (keywords(ref) & cur_anchor_kw)
            ]

            out.append("#### Bridge Check → Clip %s to Clip %s" % (s["scene_number"], nxt["scene_number"]))
            out.append("")
            out.append("- **Next clip start state:** %s" % (next_start or "(not specified)"))
            if shared:
                out.append(
                    "- **Visual connection:** Likely — this end frame and the next start state share: %s. "
                    "Confirm the end frame leads cleanly into them." % ", ".join(shared)
                )
            else:
                out.append(
                    "- **Visual connection:** Needs manual check — no shared visual anchors detected "
                    "between this end frame and the next start state."
                )
            if unanchored:
                out.append(
                    "- **Continuity risk:** Next clip relies on anchors not clearly present in this clip: %s. "
                    "Verify the end frame establishes them before generating." % ", ".join(unanchored)
                )
            else:
                out.append(
                    "- **Continuity risk:** Low — every continuity anchor the next clip needs is already "
                    "present in this clip."
                )
            out.append("")

    # Global Negative Constraints
    out.append("## Negative Constraints (Global)")
    out.append("")
    gneg = cb.get("negative_constraints")
    if isinstance(gneg, list) and gneg:
        for item in gneg:
            out.append("- %s" % item)
    else:
        out.append("- (none defined in continuity bible)")
    out.append("")

    # Final Execution Checklist
    out.append("## Final Execution Checklist")
    out.append("")
    checklist = None
    exports = data.get("exports")
    if isinstance(exports, dict) and isinstance(exports.get("review_checklist"), list) and exports["review_checklist"]:
        checklist = exports["review_checklist"]
    if not checklist:
        checklist = DEFAULT_CHECKLIST
    for item in checklist:
        out.append("- [ ] %s" % item)
    out.append("")

    return "\n".join(out)


def main(argv):
    if len(argv) != 2:
        sys.stderr.write("Usage: python scripts/render_project.py <project.json>\n")
        return 2

    path = argv[1]
    if not os.path.isfile(path):
        sys.stderr.write("Error: file not found: %s\n" % path)
        return 2

    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        sys.stderr.write("Error: invalid JSON in %s: %s\n" % (path, e))
        return 1

    errors = validate(data)
    if errors:
        sys.stderr.write("Validation failed (%d issue(s)):\n" % len(errors))
        for e in errors:
            sys.stderr.write("  - %s\n" % e)
        return 1

    markdown = render(data)

    slug = slugify(data["project"]["title"])
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    exports_dir = os.path.join(repo_root, "exports")
    os.makedirs(exports_dir, exist_ok=True)
    out_path = os.path.join(exports_dir, "%s-flow-export.md" % slug)

    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(markdown)

    try:
        shown = os.path.relpath(out_path, os.getcwd())
    except ValueError:
        shown = out_path
    print("Rendered %d clip(s)." % len(data["scenes"]))
    print("Export written to: %s" % shown)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
