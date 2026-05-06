# {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if attempt %}
Retry attempt #{{ attempt }}.
{% endif %}
