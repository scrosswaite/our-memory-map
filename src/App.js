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

/* ---------------- Category → colour mapping ---------------- */
const CATEGORY_COLORS = {
  holiday: "#f59e0b",   // amber
  datenight: "#ec4899", // pink
  friends: "#22c55e",   // green
  work: "#3b82f6",      // blue
  other: "#6b7280",     // gray
  default: "#3b82f6",
};

/* ---------------- Build a coloured SVG pin as a Leaflet icon ---------------- */
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

// Cache icons so we don't rebuild each render
const iconCache = new Map();
function iconForCategory(catRaw) {
  const key = (catRaw || "default").toString().trim().toLowerCase();
  const color = CATEGORY_COLORS[key] || CATEGORY_COLORS.default;
  if (!iconCache.has(color)) iconCache.set(color, makePinIcon(color));
  return iconCache.get(color);
}

/* ---------------- Helpers ---------------- */
// Normalise any coordinate shape into [lat, lng]
function toLatLng(coord) {
  if (!coord) return null;

  // Firestore GeoPoint (preferred)
  if (typeof coord.latitude === "number" && typeof coord.longitude === "number") {
    return [coord.latitude, coord.longitude];
  }

  // Common shapes with numbers
  if (typeof coord.lat === "number" && typeof (coord.lng ?? coord.lon) === "number") {
    return [coord.lat, coord.lng ?? coord.lon];
  }

  // Capitalised / string variants
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
async function addMemory({ title, description, lat, lng, file, category }) {
  let imageUrl = "";

  // Upload image (if provided) and fetch public URL
  if (file) {
    const path = `memories/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    imageUrl = await getDownloadURL(storageRef);
  }

  // Write Firestore doc (use GeoPoint for coordinates)
  await addDoc(collection(db, "memories"), {
    title,
    description: description ?? "",
    coordinates: new GeoPoint(Number(lat), Number(lng)),
    imageUrl: imageUrl || null, // or "images: [{ url: imageUrl }]" if you later want arrays
    category: (category || "other").toLowerCase().trim(),
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
  const [category, setCategory] = useState("holiday");
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
      await addMemory({ title, description, lat, lng, file, category });
      // reset form
      setTitle(""); setDescription(""); setLat(""); setLng(""); setFile(null);
      setCategory("holiday");
      onClose?.(); // close after add
    } catch (err) {
      console.error(err);
      alert("Failed to add marker");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="add-form"
      onSubmit={submit}
      style={{
        position: "absolute",
        left: 16,
        bottom: 70,        // sits above the FAB
        zIndex: 1000,
        width: 320,
        maxWidth: "90vw",
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong>Add Memory</strong>
        <button
          type="button"
          onClick={onClose}
          style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer" }}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="row" style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          className="text"
          placeholder="Title *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          style={inputStyle}
        />
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <textarea
          className="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      <div className="row two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input
          className="text"
          placeholder="Latitude *"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          className="text"
          placeholder="Longitude *"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          required
          style={inputStyle}
        />
      </div>

      <div className="row two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <select
          className="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          title="Category"
          style={inputStyle}
        >
          <option value="holiday">Holiday</option>
          <option value="datenight">Date night</option>
          <option value="friends">Out with friends</option>
          <option value="work">Work</option>
          <option value="other">Other</option>
        </select>

        <input
          className="file"
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          title="Image (optional)"
          style={inputStyle}
        />
      </div>

      <button
        className="btn"
        disabled={saving}
        style={{
          background: "#111827",
          color: "#fff",
          border: "none",
          padding: "8px 12px",
          borderRadius: 8,
          cursor: "pointer",
          width: "100%",
        }}
      >
        {saving ? "Saving..." : "Add Marker"}
      </button>
    </form>
  );
}

const inputStyle = {
  width: "100%",
  padding: 8,
  border: "1px solid #d1d5db",
  borderRadius: 8,
  outline: "none",
};

/* ---------------- Main App ---------------- */
export default function App() {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Default centre if no points yet (Paris)
  const initialPosition = [48.8584, 2.2945];

  useEffect(() => {
    // Real-time subscription so new markers appear immediately
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

  // Centre map on the first valid memory position if available
  const firstValidPos =
    memories
      .map((m) => toLatLng(m.coordinates ?? m.Coordinates ?? m.location ?? m.position ?? null))
      .find(Boolean) || initialPosition;

  // Delete a memory document (note: this doesn't delete Storage image)
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
      {/* Map */}
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
          const category =
            (memory.category ?? memory.Category ?? memory.type ?? "other").toString();

          return (
            <Marker
              key={memory.id}
              position={pos}
              icon={iconForCategory(category)}
              riseOnHover
            >
              {/* Hover: thumbnail + title */}
              {thumb && (
                <Tooltip direction="top" offset={[0, -20]} opacity={1} sticky>
                  <div style={{ maxWidth: 200 }}>
                    <strong>{title}</strong>
                    <img src={thumb} alt={title} className="tooltip-thumbnail" loading="lazy" />
                  </div>
                </Tooltip>
              )}

              {/* Click: full popup with description + gallery + delete */}
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
                    <div className="popup-gallery" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginTop: 8 }}>
                      {images.map((img, i) => (
                        <figure key={i} className="popup-figure" style={{ margin: 0 }}>
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

                  <p style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                    Category: <b>{category}</b>
                  </p>
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
