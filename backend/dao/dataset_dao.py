from datasets.models import Dataset


def datasets_for_user(user):
    # Every list starts from the authenticated owner; callers cannot supply IDs.
    return Dataset.objects.filter(owner=user)


def insert_dataset(dataset):
    dataset.save(force_insert=True)
    return dataset
