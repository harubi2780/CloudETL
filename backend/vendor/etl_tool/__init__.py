"""Preserved tool modules; demo runners are excluded from unittest discovery."""


def load_tests(loader, standard_tests, pattern):
    # test_user_choices.py is an upstream demo with standalone absolute imports.
    # Keep its bytes intact and test the application adapter in backend/tests/.
    return standard_tests
