#!/usr/bin/env python3
"""Validate parsed Compose settings without printing credential values."""
import json
import sys


def verify(configuration):
    services = configuration['services']
    bot, api = services['bot']['environment'], services['api']['environment']
    for key in ('DISCORD_BOT_TOKEN', 'CORE_API_TOKEN'):
        value = bot.get(key)
        if not isinstance(value, str) or not value or value != value.strip() or api.get(key) != value:
            raise ValueError('Service identity mismatch')
    if api.get('DISCORD_OUTPUT_ENABLED') not in ('true', 'false'):
        raise ValueError('Explicit output enablement is required')


if __name__ == '__main__':
    try:
        verify(json.load(sys.stdin))
    except (ValueError, KeyError, TypeError, AttributeError):
        print('service-settings: matching Bot/API credentials and explicit output enablement are required', file=sys.stderr)
        sys.exit(1)
