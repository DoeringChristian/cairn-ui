"""cairn_ui.cards — drive the Cairn browser viewer from Python.

The authoring half of the viewer: it builds card specs the browser's renderer
consumes, and elements that embed those cards in a notebook. It renders nothing
itself — the browser does, at ``/embed/card``.

Reached as :mod:`cairn.ui`, which is a thin binding onto this module, the way
:mod:`cairn.plot` binds onto ``cairn_plot``. It lives here rather than in
cairn-track because it is part of the viewer, not part of the tracker.

Deliberately NOT imported by ``cairn_ui/__init__.py``: ``cairn.viewer`` imports
that package to locate the bundle, and pulling this in would make the server
import the renderer.

Everything here needs a reachable cairn server that is *serving* the viewer,
since a card is ultimately rendered by the browser at ``/embed/card``. Without
one the elements degrade to an inline notice rather than raising.

That server may be remote; building a card spec needs no local bundle.
"""

from __future__ import annotations

from .spec import CardSettingsSpec, CardSpec, SeriesRef
from .compare import (
    boxes_compare,
    image_compare,
    media_compare,
    mesh_compare,
    pointcloud_compare,
    volume_compare,
)
from .elements import CardElement

__all__ = [
    "CardElement",
    "CardSpec",
    "CardSettingsSpec",
    "SeriesRef",
    "media_compare",
    "image_compare",
    "mesh_compare",
    "pointcloud_compare",
    "volume_compare",
    "boxes_compare",
]
