from django.db import migrations


def follow_free_default(apps, schema_editor):
    # Previous demo/verification tools stored the old default explicitly. These
    # ordinary Free records should now follow 500 MiB, not retain 1 GiB forever.
    apps.get_model("accounts", "AccountEntitlement").objects.filter(
        plan_code="free", storage_limit_bytes=1073741824,
    ).update(storage_limit_bytes=None)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]
    operations = [migrations.RunPython(follow_free_default, migrations.RunPython.noop)]
