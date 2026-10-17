---
tags:
  - project
  - banim
  - csharp
  - a-level
  - animation
status: done
github: https://github.com/BlueBeard63/BAnim
language: C#
created: 2023-04-09
updated: 2026-10-17
summary: Frame-by-frame sprite animation engine
languages:
  - C#
area: A-Level
category: Library
---

## Overview

A small engine for frame-by-frame sprite animation, written for my A-Level coursework. Sprites are defined as sheets plus a timeline, and the engine handles playback, looping and events on specific frames.

## The problem

Every game project I started re-implemented the same animation loop badly — so I pulled it out into a library with a proper timeline model.

## What I built

- Timeline model with per-frame events
- Sprite sheet slicing with metadata
- A preview window for scrubbing through frames

![[banim-preview.png|The preview window]]

The timeline format was inspired by [[Aseprite notes]], which stay private.

## Notes

Random thoughts that should not go on the portfolio.
