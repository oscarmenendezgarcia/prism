---
title: System Architecture and Components
author: user
pinned: false
created: 2026-05-31T00:00:00.000Z
updated: 2026-05-31T00:00:00.000Z
tags: [architecture, system, components]
---

## System architecture

This page describes the overall software architecture and system design: how
the components fit together and the trade-offs behind the layout.

The architecture splits into a space-agnostic core and a thin binding layer.
The core owns the data model; the binding wires components to a space. This
component boundary is the central architectural decision and keeps the system
extractable.
