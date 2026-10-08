"""Viewer pages inline in a notebook: a run page, the project workspace, a report.

Each returns a :class:`PageElement`, an ``<iframe>`` to the page's embed entry
(``/embed/run/<id>``, ``/embed/workspace/<project>``,
``/embed/report/<project>/<id>``): the page without the app's navigation,
live like the page itself, read-gated like the app.

``cairn.Run`` (and a ``Reader`` run) display their run page this way as the
last expression of a cell; ``run.display(tab=..., height=...)`` picks the tab.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

from .elements import _DEFAULT_PAGE_HEIGHT, PageElement

#: The run page's tabs (cairn-ui ``src/lib/embed.ts`` ``RUN_TABS``).
RUN_TABS = ("workspace", "overview", "system", "logs", "files", "artifacts")


def _seg(text: str) -> str:
    return quote(str(text), safe="")


def run_page(
    run_id: str,
    *,
    tab: str = "workspace",
    height: int = _DEFAULT_PAGE_HEIGHT,
    server: str | None = None,
    repo_path: str | Path | None = None,
) -> PageElement:
    """A run's page (``tab``: workspace, overview, system, logs, files, artifacts).

    ``server`` is the viewer the run's data comes from when known (a run over
    HTTP), ``repo_path`` the local repo (to find the ``cairn ui`` serving it).
    """
    if tab not in RUN_TABS:
        raise ValueError(f"unknown run page tab {tab!r}; one of {', '.join(RUN_TABS)}")
    path = f"/embed/run/{_seg(run_id)}" + ("" if tab == "workspace" else f"?{urlencode({'tab': tab})}")
    return PageElement(path, height=height, reader_server=server, repo_path=repo_path)


def workspace(
    project: str,
    filter: str | Mapping[str, Any] | None = None,
    *,
    height: int = _DEFAULT_PAGE_HEIGHT,
    server: str | None = None,
) -> PageElement:
    """The project's workspace inline: the runs sidebar and the cards.

    ``filter`` narrows the runs as the runs table's filter does, for this
    embed only (the workspace view is not changed): an expression
    (``'run.group == "exp-44"'``) or a filter tree
    (``{"kind": "group", "op": "and", "children": [...]}``).
    """
    path = f"/embed/workspace/{_seg(project)}"
    if filter is not None:
        text = filter if isinstance(filter, str) else json.dumps(dict(filter), separators=(",", ":"))
        path += f"?{urlencode({'filter': text})}"
    return PageElement(path, height=height, server=server)


def report(
    project: str,
    report_id: str,
    *,
    height: int = _DEFAULT_PAGE_HEIGHT,
    server: str | None = None,
) -> PageElement:
    """A report inline, read-only."""
    return PageElement(f"/embed/report/{_seg(project)}/{_seg(report_id)}", height=height, server=server)
