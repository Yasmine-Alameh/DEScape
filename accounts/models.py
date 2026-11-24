"""Accounts: student profile and lesson completion."""
from django.conf import settings
from django.db import models


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    # Notebook pages the student has "discovered" in the game (all pages stay readable).
    notebook_unlocked = models.JSONField(default=list, blank=True)
    is_demo = models.BooleanField(default=False, help_text="Created by the seed_demo command")
    created_at = models.DateTimeField(auto_now_add=True)

    def unlock_notebook(self, keys):
        changed = False
        for k in keys:
            if k not in self.notebook_unlocked:
                self.notebook_unlocked.append(k)
                changed = True
        if changed:
            self.save(update_fields=["notebook_unlocked"])

    def __str__(self):
        return self.user.username


class TutorialCompletion(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tutorials")
    tutorial_id = models.CharField(max_length=40)
    completed_at = models.DateTimeField(auto_now=True)
    skipped = models.BooleanField(default=False)

    class Meta:
        unique_together = [("user", "tutorial_id")]
