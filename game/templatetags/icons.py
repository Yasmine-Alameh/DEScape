from django import template

from game import icons

register = template.Library()


@register.simple_tag
def icon(name, cls=""):
    """{% icon "lock" %} → inline SVG line icon."""
    return icons.svg(name, cls)
