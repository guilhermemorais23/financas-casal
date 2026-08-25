import { FirebaseError } from "firebase/app";
import { EmailAuthProvider, reauthenticateWithCredential, verifyBeforeUpdateEmail } from "firebase/auth";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { authErrorMessage } from "../auth/firebaseErrors";
import { useAuth } from "../auth/AuthContext";
import { firebaseAuth } from "../firebase";

const AVATAR_SIZE = 160;

// Resizes/crops to a small square and re-encodes as JPEG so the resulting
// data URL comfortably clears the backend's size cap regardless of how big
// the original photo was -- no server-side image processing needed.
function compressToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Não foi possível ler a imagem"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas indisponível"));
          return;
        }
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function ProfileSettingsModal({ onClose }: { onClose: () => void }) {
  const { user, token, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(user?.photoDataUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only shown when Firebase demands a fresh login before letting the email
  // change go through -- not part of the form otherwise.
  const [needsCurrentPassword, setNeedsCurrentPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressToAvatarDataUrl(file);
      setPhotoDataUrl(dataUrl);
    } catch {
      setError("Não foi possível processar essa imagem.");
    }
  }

  async function changeEmailIfNeeded(): Promise<boolean> {
    const trimmedEmail = email.trim();
    if (!user || trimmedEmail === user.email) return true;

    const firebaseUser = firebaseAuth.currentUser;
    if (!firebaseUser) return false;

    try {
      if (needsCurrentPassword) {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(firebaseUser, credential);
      }
      await verifyBeforeUpdateEmail(firebaseUser, trimmedEmail);
      setInfo("Enviamos um link de confirmação pro novo email -- ele só passa a valer depois que você clicar nele.");
      setNeedsCurrentPassword(false);
      return true;
    } catch (err) {
      if (err instanceof FirebaseError && err.code === "auth/requires-recent-login") {
        setNeedsCurrentPassword(true);
        setError("Por segurança, confirme sua senha atual pra trocar o email.");
        return false;
      }
      setError(authErrorMessage(err, "Não foi possível trocar o email"));
      return false;
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (!displayName.trim()) {
      setError("Informe um nome.");
      return;
    }

    setIsSubmitting(true);
    try {
      const emailOk = await changeEmailIfNeeded();
      if (!emailOk) {
        setIsSubmitting(false);
        return;
      }

      await apiRequest("/me", {
        method: "PATCH",
        token,
        body: {
          displayName: displayName.trim(),
          photoDataUrl,
          phone: phone.trim() || null,
          email: email.trim(),
        },
      });
      await refreshUser();

      // Email verification is still pending -- keep the modal open so the
      // user actually sees that message instead of it flashing and closing.
      if (email.trim() !== user?.email) {
        setIsSubmitting(false);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar o perfil");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h1>Editar perfil</h1>

        <form onSubmit={handleSubmit}>
          <div className="profile-avatar-picker">
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="" className="profile-avatar-preview" />
            ) : (
              <span className="profile-avatar-preview profile-avatar-fallback">
                {displayName.charAt(0).toUpperCase() || "?"}
              </span>
            )}
            <div className="profile-avatar-actions">
              <button type="button" className="btn btn-outline" onClick={() => fileInputRef.current?.click()}>
                {photoDataUrl ? "Trocar foto" : "Adicionar foto"}
              </button>
              {photoDataUrl && (
                <button type="button" className="link-button" onClick={() => setPhotoDataUrl(null)}>
                  Remover foto
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoChange} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="profile-name">Nome</label>
            <input
              id="profile-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="profile-email">Email</label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {needsCurrentPassword && (
            <div className="field">
              <label htmlFor="profile-current-password">Senha atual</label>
              <input
                id="profile-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="profile-phone">Telefone (opcional)</label>
            <input
              id="profile-phone"
              type="tel"
              placeholder="(11) 91234-5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {info && <p className="card-subtitle">{info}</p>}

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              {info ? "Fechar" : "Cancelar"}
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
