#!/usr/bin/env python3
"""
transcribe.py — Local AssemblyAI transcription CLI for Neon Post.

Usage:
  python3 scripts/transcribe.py <file_or_url> [--key KEY]

Output: JSON to stdout with { text, language, duration, segments }
Exit 0 on success, 1 on error (error JSON to stdout).

Requires: pip install assemblyai
"""

import sys
import os
import json
import time


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(json.dumps({"error": "Usage: transcribe.py <file_or_url> [--key KEY]"}))
        sys.exit(1)

    source = sys.argv[1]
    api_key = None

    # Parse --key flag
    for i, arg in enumerate(sys.argv):
        if arg == "--key" and i + 1 < len(sys.argv):
            api_key = sys.argv[i + 1]
            break

    # Fall back to env var
    if not api_key:
        api_key = os.environ.get("ASSEMBLYAI_API_KEY", "")

    if not api_key:
        print(json.dumps({"error": "No API key. Pass --key KEY or set ASSEMBLYAI_API_KEY"}))
        sys.exit(1)

    try:
        import assemblyai as aai
    except ImportError:
        print(json.dumps({"error": "assemblyai not installed. Run: pip install assemblyai"}))
        sys.exit(1)

    aai.settings.api_key = api_key

    try:
        config = aai.TranscriptionConfig(
            language_detection=True,
            speech_model=aai.SpeechModel.universal,
        )

        transcriber = aai.Transcriber(config=config)

        start = time.time()
        transcript = transcriber.transcribe(source)
        elapsed = time.time() - start

        if transcript.status == aai.TranscriptStatus.error:
            print(json.dumps({"error": f"Transcription failed: {transcript.error}"}))
            sys.exit(1)

        segments = []
        if transcript.utterances:
            for u in transcript.utterances:
                seg = {
                    "start": u.start / 1000.0,
                    "end": u.end / 1000.0,
                    "text": u.text,
                }
                if hasattr(u, "speaker") and u.speaker:
                    seg["speaker"] = u.speaker
                segments.append(seg)
        elif transcript.words:
            # Group words into ~10-second chunks
            chunk_text = []
            chunk_start = 0
            for w in transcript.words:
                if not chunk_text:
                    chunk_start = w.start / 1000.0
                chunk_text.append(w.text)
                if w.end / 1000.0 - chunk_start >= 10.0:
                    segments.append({
                        "start": chunk_start,
                        "end": w.end / 1000.0,
                        "text": " ".join(chunk_text),
                    })
                    chunk_text = []
            if chunk_text:
                segments.append({
                    "start": chunk_start,
                    "end": (transcript.words[-1].end / 1000.0) if transcript.words else 0,
                    "text": " ".join(chunk_text),
                })
        else:
            segments.append({
                "start": 0,
                "end": transcript.audio_duration or 0,
                "text": transcript.text or "",
            })

        # Extract chapters if available
        chapters = []
        if hasattr(transcript, "chapters") and transcript.chapters:
            for ch in transcript.chapters:
                chapters.append({
                    "start": ch.start / 1000.0,
                    "end": ch.end / 1000.0,
                    "headline": ch.headline,
                    "summary": ch.summary,
                    "gist": ch.gist,
                })

        lang = "en"
        if hasattr(transcript, "json_response") and transcript.json_response:
            lang = transcript.json_response.get("language_code", "en")

        result = {
            "text": transcript.text or "",
            "language": lang,
            "duration": transcript.audio_duration or elapsed,
            "segments": segments,
            "model": "universal_v3",
        }

        if chapters:
            result["chapters"] = chapters

        print(json.dumps(result))
        sys.exit(0)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
