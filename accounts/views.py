from django.contrib import messages
from django.contrib.auth import login, update_session_auth_hash
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import PasswordChangeForm
from django.shortcuts import redirect, render

from .forms import StudentRegistrationForm


def register(request):
    if request.user.is_authenticated:
        return redirect("dashboard")
    form = StudentRegistrationForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        user = form.save()
        login(request, user)
        messages.success(request, f"Welcome to DEScape, {user.username}!")
        return redirect("dashboard")
    return render(request, "accounts/register.html", {"form": form})



@login_required
def profile(request):
    """Settings: the signed-in player's profile details and password change in one place."""
    from game.models import Attempt
    user = request.user
    form = PasswordChangeForm(user, request.POST or None)
    if request.method == "POST" and form.is_valid():
        form.save()
        update_session_auth_hash(request, form.user)
        messages.success(request, "Your password was changed.")
        return redirect("profile")
    attempts = user.attempts.all()
    completed = [a for a in attempts if a.status == Attempt.COMPLETED]
    return render(request, "accounts/profile.html", {
        "form": form,
        "adventures": attempts.count(),
        "completed": len(completed),
        "best_score": max([a.score for a in completed], default=0),
        "badges": user.achievements.count() if hasattr(user, "achievements") else None,
    })
