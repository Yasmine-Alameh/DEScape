from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User


class StudentRegistrationForm(UserCreationForm):
    email = forms.EmailField(required=False, help_text="Optional. Needed if you want to reset a forgotten password by email.")

    class Meta:
        model = User
        fields = ("username", "email")
        labels = {"username": "Username or nickname"}

    def clean_email(self):
        email = self.cleaned_data.get("email", "").strip()
        if email and User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("An account with this email already exists.")
        return email

