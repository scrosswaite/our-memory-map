// src/App.js
import React, { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from "react-leaflet";

import { db, storage } from "./firebase";
import {
  collection,
  onSnapshot,
  addDoc,
  GeoPoint,
  serverTimestamp,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import L from "leaflet";
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

/* ---------------- Leaflet default icon (fallback) ---------------- */
const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

/* ---------------- Category → default colour (fallback only) ---------------- */
const CATEGORY_COLORS = {
  holiday: "#f59e0b",   // amber
  datenight: "#ec4899", // pink
  friends: "#22c55e",   // green
  work: "#3b82f6",      // blue
  other: "#6b7280",     // gray
  default: "#3b82f6",
};

/* ---------------- Coloured SVG pin icon ---------------- */
function makePinIcon(color, stroke = "#111827") {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
  <path d="M12.5 0C6 0 0 5.2 0 12c0 9 12.5 29 12.5 29S25 21 25 12C25 5.2 19 0 12.5 0z"
        fill="${color}" stroke="${stroke}" stroke-width="1" />
  <circle cx="12.5" cy="12" r="5" fill="#ffffff"/>
</svg>`;
  return L.icon({
    iconUrl: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: iconShadow,
    shadowSize: [41, 41],
  });
}

/* cache icons by color */
const colorIconCache = new Map();
function iconFromColor(color) {
  if (!colorIconCache.has(color)) {
    colorIconCache.set(color, makePinIcon(color));
  }
  return colorIconCache.get(color);
}

/* normalize color string (accepts #rgb or #rrggbb) */
function normalizeColor(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    // expand #abc → #aabbcc
    const r = s[1], g = s[2], b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

/* choose icon for a memory: prefer explicit color, else fallback by category */
function iconForMemory(memory) {
  const explicit = normalizeColor(memory.color || memory.pinColor || memory.colour);
  if (explicit) return iconFromColor(explicit);

  const fallback =
    CATEGORY_COLORS[(memory.category || "").toString().trim().toLowerCase()] ||
    CATEGORY_COLORS.default;
  return iconFromColor(fallback);
}

/* ---------------- Helpers ---------------- */
// Normalise any coordinate shape into [lat, lng]
function toLatLng(coord) {
  if (!coord) return null;

  if (typeof coord.latitude === "number" && typeof coord.longitude === "number") {
    return [coord.latitude, coord.longitude];
  }
  if (typeof coord.lat === "number" && typeof (coord.lng ?? coord.lon) === "number") {
    return [coord.lat, coord.lng ?? coord.lon];
  }
  const rawLat = coord.Latitude ?? coord.LAT ?? coord.lat ?? coord.latitude;
  const rawLng = coord.Longitude ?? coord.LONG ?? coord.lng ?? coord.lon ?? coord.longitude;
  const lat = typeof rawLat === "number" ? rawLat : parseFloat(rawLat);
  const lng = typeof rawLng === "number" ? rawLng : parseFloat(rawLng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

// Title + description safe getters
function getTextFields(memory) {
  const title = memory.title ?? memory.name ?? memory.Title ?? "Untitled location";
  const description =
    memory.description ??
    memory.desc ??
    memory.Details ??
    memory.text ??
    memory.Description ??
    "";
  return { title, description };
}

// Normalise images to [{src, caption}]
function getImages(memory) {
  const raw =
    memory.images ??
    memory.photos ??
    memory.image ??
    memory.photo ??
    memory.imageUrl ??
    memory.imageURL ??
    memory.Image ??
    [];
  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw
      .map((item) => {
        if (typeof item === "string") return { src: item, caption: "" };
        if (item && typeof item === "object") {
          const src = item.url ?? item.src ?? item.downloadURL ?? "";
          const caption = item.caption ?? item.alt ?? "";
          return src ? { src, caption } : null;
        }
        return null;
      })
      .filter(Boolean);
  } else if (typeof raw === "string") {
    arr = [{ src: raw, caption: "" }];
  } else if (raw && typeof raw === "object") {
    const src = raw.url ?? raw.src ?? raw.downloadURL ?? "";
    const caption = raw.caption ?? raw.alt ?? "";
    if (src) arr = [{ src, caption }];
  }
  return arr;
}

/* ---------------- Firestore: add a memory ---------------- */
async function addMemory({ title, description, lat, lng, file, category, color }) {
  let imageUrl = "";

  if (file) {
    const path = `memories/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    imageUrl = await getDownloadURL(storageRef);
  }

  await addDoc(collection(db, "memories"), {
    title,
    description: description ?? "",
    coordinates: new GeoPoint(Number(lat), Number(lng)),
    imageUrl: imageUrl || null,
    category: (category || "").trim(),            // free text
    color: normalizeColor(color) || null,         // explicit pin colour
    createdAt: serverTimestamp(),
  });
}

/* ---------------- Add Memory Form (toggleable) ---------------- */
function AddMemoryForm({ onClose }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState("");      // free text
  const [color, setColor] = useState("#3b82f6");     // chosen pin colour
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        alert("Please enter valid numeric latitude and longitude.");
        setSaving(false);
        return;
      }
      await addMemory({ title, description, lat, lng, file, category, color });
      setTitle(""); setDescription(""); setLat(""); setLng("");
      setFile(null); setCategory(""); setColor("#3b82f6");
      onClose?.();
    } catch (err) {
      console.error(err);
      alert("Failed to add marker");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="memory-form" onSubmit={submit}>
      <div className="memory-form__header">
        <strong>Add Memory</strong>
        <button type="button" className="memory-form__close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="memory-form__row">
        <input
          className="memory-form__input"
          placeholder="Title *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="memory-form__row">
        <textarea
          className="memory-form__input"
          placeholder="Description (optional)"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="memory-form__grid-2">
        <input
          className="memory-form__input"
          placeholder="Latitude *"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          required
        />
        <input
          className="memory-form__input"
          placeholder="Longitude *"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          required
        />
      </div>

      <div className="memory-form__grid-2">
        {/* Free-text category */}
        <input
          className="memory-form__input"
          placeholder="Category (anything)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />

        {/* Pick marker colour */}
        <div className="memory-form__color memory-form__input">
          <label htmlFor="pinColor">Marker colour</label>
          <input
            id="pinColor"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Choose pin colour"
          />
        </div>
      </div>

      <div className="memory-form__row">
        <input
          className="memory-form__input"
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          title="Image (optional)"
        />
      </div>

      <button className="memory-form__btn" disabled={saving}>
        {saving ? "Saving..." : "Add Marker"}
      </button>
    </form>
  );
}


/* ----- inline styles for the popup card (compact & tidy) ----- */
const formCardStyle = {
  position: "absolute",
  left: 16,
  bottom: 70,     // sits above the FAB
  zIndex: 1000,
  width: 360,     // compact width (was wider before)
  maxWidth: "92vw",
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 12,
  boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
};
const formHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 8,
};
const closeBtnStyle = {
  background: "transparent",
  border: "none",
  fontSize: 18,
  cursor: "pointer",
  lineHeight: 1,
};
const rowStyle = { display: "flex", gap: 8, marginBottom: 8 };
const grid2Style = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
  marginBottom: 8,
};
const inputStyle = {
  width: "100%",
  padding: 10,
  border: "1px solid #d1d5db",
  borderRadius: 10,
  outline: "none",
  fontSize: 14,
};
const submitBtnStyle = {
  background: "#111827",
  color: "#fff",
  border: "none",
  padding: "10px 12px",
  borderRadius: 10,
  cursor: "pointer",
  width: "100%",
  fontSize: 14,
  fontWeight: 600,
};

/* ---------------- Main App ---------------- */
export default function App() {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const initialPosition = [48.8584, 2.2945]; // Paris

  useEffect(() => {
    const col = collection(db, "memories");
    const unsub = onSnapshot(
      col,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMemories(list);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching memories: ", error);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  if (loading) return <div>Loading memories...</div>;

  const firstValidPos =
    memories
      .map((m) => toLatLng(m.coordinates ?? m.Coordinates ?? m.location ?? m.position ?? null))
      .find(Boolean) || initialPosition;

  const handleDelete = async (id, title = "") => {
    const ok = window.confirm(`Delete "${title || "this memory"}"?`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "memories", id));
    } catch (err) {
      console.error(err);
      alert("Failed to delete marker");
    }
  };

  return (
    <div className="page" style={{ position: "relative" }}>
      <MapContainer center={firstValidPos} zoom={13} style={{ height: "90vh", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {memories.map((memory) => {
          const coordField =
            memory.coordinates ?? memory.Coordinates ?? memory.location ?? memory.position;
          const pos = toLatLng(coordField);
          if (!pos) return null;

          const { title, description } = getTextFields(memory);
          const images = getImages(memory);
          const thumb = images[0]?.src;

          return (
            <Marker
              key={memory.id}
              position={pos}
              icon={iconForMemory(memory)}
              riseOnHover
            >
              {thumb && (
                <Tooltip direction="top" offset={[0, -20]} opacity={1} sticky>
                  <div style={{ maxWidth: 200 }}>
                    <strong>{title}</strong>
                    <img src={thumb} alt={title} className="tooltip-thumbnail" loading="lazy" />
                  </div>
                </Tooltip>
              )}

              <Popup>
                <div style={{ maxWidth: 300 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{title}</strong>
                    <button
                      onClick={() => handleDelete(memory.id, title)}
                      style={{
                        background: "#ef4444",
                        color: "#fff",
                        border: "none",
                        padding: "4px 8px",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                      title="Delete marker"
                    >
                      Delete
                    </button>
                  </div>

                  {description && (
                    <p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>{description}</p>
                  )}

                  {images.length > 0 && (
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                      gap: 8, marginTop: 8
                    }}>
                      {images.map((img, i) => (
                        <figure key={i} style={{ margin: 0 }}>
                          <img
                            src={img.src}
                            alt={img.caption || title}
                            loading="lazy"
                            style={{ width: "100%", height: "auto", borderRadius: 8, objectFit: "cover" }}
                          />
                          {img.caption && (
                            <figcaption style={{ fontSize: 12, color: "#555", marginTop: 4, lineHeight: 1.2 }}>
                              {img.caption}
                            </figcaption>
                          )}
                        </figure>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                    {memory.category && <>Category: <b>{memory.category}</b></>}
                    {memory.color && (
                      <span style={{ marginLeft: 8 }}>
                        Colour:
                        <span
                          style={{
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            background: normalizeColor(memory.color) || "#000",
                            borderRadius: 3,
                            marginLeft: 6,
                            verticalAlign: "middle",
                          }}
                        />
                      </span>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {/* Floating "Add Memory" button (bottom-left) */}
      <button
        onClick={() => setShowForm((s) => !s)}
        style={{
          position: "absolute",
          left: 16,
          bottom: 16,
          zIndex: 1000,
          background: "#111827",
          color: "#fff",
          border: "none",
          padding: "10px 14px",
          borderRadius: 999,
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
        }}
        title="Add Memory"
      >
        {showForm ? "Close" : "Add Memory"}
      </button>

      {/* Toggleable form */}
      {showForm && <AddMemoryForm onClose={() => setShowForm(false)} />}
    </div>
  );
}
