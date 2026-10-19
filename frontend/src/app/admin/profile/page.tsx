"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiError } from "@/services/api-client";
import { ispApi, type AuthUser } from "@/services/isp-api";
import { ArrowRight, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AdminProfilePage() {
    const router = useRouter();
    const [user, setUser] = useState<AuthUser | null>(null);
    const [avatar, setAvatar] = useState<File | undefined>();
    const [preview, setPreview] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [passwordBusy, setPasswordBusy] = useState(false);
    const [passwordMessage, setPasswordMessage] = useState("");
    const [passwordError, setPasswordError] = useState("");
    useEffect(() => { ispApi.me().then(setUser).catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : "Unable to load profile.")); }, []);
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!user) return;
        setBusy(true); setError(""); setMessage("");
        const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
        try { const updated = await ispApi.updateProfile(name, avatar); setUser(updated); setAvatar(undefined); setPreview(null); setMessage("Profile updated successfully."); }
        catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not update profile."); }
        finally { setBusy(false); }
    }
    async function changePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const current = String(form.get("current_password") ?? "");
        const password = String(form.get("new_password") ?? "");
        const confirmation = String(form.get("password_confirmation") ?? "");
        setPasswordBusy(true); setPasswordError(""); setPasswordMessage("");
        if (password !== confirmation) { setPasswordError("New password and confirmation do not match."); setPasswordBusy(false); return; }
        try { await ispApi.updatePassword(current, password, confirmation); setPasswordMessage("Password updated. Please sign in again with your new password."); window.setTimeout(() => router.replace("/admin/login"), 1200); }
        catch (cause) { setPasswordError(cause instanceof ApiError ? cause.message : "Could not update password."); }
        finally { setPasswordBusy(false); }
    }
    return <><section className="data-panel profile-editor"><div className="data-panel-heading"><div><span className="eyebrow">ACCOUNT SETTINGS</span><h2>My profile</h2><p>Update the name and profile photo shown in the admin panel.</p></div></div>{!user ? <p role="status">Loading profile…</p> : <form className="profile-editor-form" onSubmit={save}><label className="avatar-upload"><span className="profile-image-preview">{preview || user.avatar_url ? <img src={preview || user.avatar_url || ""} alt="Profile preview" /> : <UserRound size={30} />}</span><span><strong>Profile photo</strong><small>JPG, PNG or WebP · maximum 2 MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setAvatar(file); setPreview(URL.createObjectURL(file)); } }} /></span></label><label className="field-label">Display name<input name="name" required minLength={2} maxLength={255} defaultValue={user.name} /></label><label className="field-label">Email address<input value={user.email} readOnly /></label><label className="field-label">Role<input value={user.role.replaceAll("_", " ")} readOnly /></label>{message && <p className="profile-message success" role="status">{message}</p>}{error && <p className="profile-message error" role="alert">{error}</p>}<button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save profile"} <ArrowRight size={15} /></button></form>}</section><section className="data-panel profile-editor password-editor"><div className="data-panel-heading"><div><span className="eyebrow">SECURITY</span><h2>Change password</h2><p>For your safety, enter your current password first. New password must be at least 12 characters.</p></div></div><form className="profile-editor-form" onSubmit={changePassword}><label className="field-label">Current password<input name="current_password" type="password" autoComplete="current-password" required /></label><label className="field-label">New password<input name="new_password" type="password" autoComplete="new-password" minLength={12} required /></label><label className="field-label">Confirm new password<input name="password_confirmation" type="password" autoComplete="new-password" minLength={12} required /></label>{passwordMessage && <p className="profile-message success" role="status">{passwordMessage}</p>}{passwordError && <p className="profile-message error" role="alert">{passwordError}</p>}<button className="button button-dark" disabled={passwordBusy}>{passwordBusy ? "Updating…" : "Update password"} <ArrowRight size={15} /></button></form></section></>;
}
