// App.jsx
import { useState, useEffect } from "react";
import "leaflet/dist/leaflet.css";
import "./App.css";
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from "react-leaflet";
import { db } from "./firebase";
import { collection, getDocs } from "firebase/firestore";
import L from "leaflet";
import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

// ---------- Leaflet default icon (works with bundlers like Vite/CRA) ----------
const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// ---------- Helper: normalise any coordinate shape into [lat, lng] ----------
function toLatLng(coord) {
  if (!coord) return null;

  // Firestore GeoPoint (preferred)
  if (
    typeof coord.latitude === "number" &&
    typeof coord.longitude === "number"
  ) {
    return [coord.latitude, coord.longitude];
  }

  // Common shapes with numbers
  if (
    typeof coord.lat === "number" &&
    typeof (coord.lng ?? coord.lon) === "number"
  ) {
    return [coord.lat, coord.lng ?? coord.lon];
  }

  // Capitalised / string variants
  const rawLat = coord.Latitude ?? coord.LAT ?? coord.lat ?? coord.latitude;
  const rawLng =
    coord.Longitude ??
    coord.LONG ??
    coord.lng ??
    coord.lon ??
    coord.longitude;

  const lat = typeof rawLat === "number" ? rawLat : parseFloat(rawLat);
  const lng = typeof rawLng === "number" ? rawLng : parseFloat(rawLng);

  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

// ---------- Helper: get title + description safely ----------
function getTextFields(memory) {
  const title =
    memory.title ?? memory.name ?? memory.Title ?? "Untitled location";

  const description =
    memory.description ??
    memory.desc ??
    memory.Details ??
    memory.text ??
    memory.Description ??
    "";

  return { title, description };
}

// ---------- Helper: normalise images to [{src, caption}] ----------
function getImages(memory) {
  // Accepts: image/imageUrl/imageURL, images[], photos[], or array of objects {url/src/downloadURL, caption}
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

export default function App() {
  // Log 1: Tracks every time the component's main body runs
  console.log("Log 1: App component is rendering or re-rendering...");

  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Default center (Paris) if we don't have any valid points yet
  const initialPosition = [48.8584, 2.2945];

  useEffect(() => {
    // Log 2: Shows that the useEffect hook has started
    console.log("Log 2: useEffect hook is running.");

    const fetchMemories = async () => {
      // Log 3: Confirms the data fetch is about to start
      console.log("Log 3: Starting to fetch memories from Firebase...");

      try {
        const col = collection(db, "memories");
        const snapshot = await getDocs(col);
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Log 4: Shows the data that was successfully fetched
        console.log("Log 4: Firebase fetch successful. Data:", list);

        // Peek at the first doc's coord field to verify shape
        const sample =
          list[0]?.coordinates ??
          list[0]?.Coordinates ??
          list[0]?.location ??
          list[0]?.position;
        console.log("Log 4a: Sample raw coord field:", sample);

        setMemories(list);
      } catch (error) {
        // Log 5: Will only show if there is an error
        console.error("Log 5: Error fetching memories: ", error);
      } finally {
        // Log 6: Confirms the fetch process is complete
        console.log("Log 6: Finished fetching. Setting loading to false.");
        setLoading(false);
      }
    };

    fetchMemories();
  }, []); // The empty array ensures this effect runs only once

  if (loading) {
    // Log 7: Indicates the component is showing the "Loading" message
    console.log("Log 7: Component is in a loading state.");
    return <div>Loading memories...</div>;
  }

  // Find the first valid position to centre on (fallback to initialPosition)
  const firstValidPos =
    memories
      .map((m) =>
        toLatLng(
          m.coordinates ?? m.Coordinates ?? m.location ?? m.position ?? null
        )
      )
      .find(Boolean) || initialPosition;

  // Log 8: Shows that the component is now ready to render the map
  console.log(
    `Log 8: Now rendering the map. Number of memories: ${memories.length}`
  );

  return (
    <MapContainer
      center={firstValidPos}
      zoom={13}
      style={{ height: "100vh", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {memories.map((memory) => {
        // Log 9: This should now run for each memory item.
        console.log(`Log 9: Mapping memory item: "${memory.title}"`, memory);

        // Try common field names for coordinates
        const coordField =
          memory.coordinates ??
          memory.Coordinates ??
          memory.location ??
          memory.position;

        const pos = toLatLng(coordField);

        if (!pos) {
          // Log 10: Will show if a memory has bad coordinate data
          console.warn(
            `Log 10: Skipping memory "${memory.title}" due to invalid coordinates.`,
            coordField
          );
          return null;
        }

        const { title, description } = getTextFields(memory);
        const images = getImages(memory);
        const thumb = images[0]?.src;

        return (
          <Marker key={memory.id} position={pos} riseOnHover>
            {/* Hover thumbnail + title */}
            {thumb && (
              <Tooltip direction="top" offset={[0, -20]} opacity={1} sticky>
                <div style={{ maxWidth: 200 }}>
                  <strong>{title}</strong>
                  <img
                    src={thumb}
                    alt={title}
                    className="tooltip-thumbnail"
                    loading="lazy"
                  />
                </div>
              </Tooltip>
            )}

            {/* Click: popup with description + gallery */}
            <Popup>
              <div style={{ maxWidth: 300 }}>
                <strong>{title}</strong>
                {description && (
                  <p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>
                    {description}
                  </p>
                )}

                {images.length > 0 && (
                  <div className="popup-gallery">
                    {images.map((img, i) => (
                      <figure key={i} className="popup-figure">
                        <img
                          src={img.src}
                          alt={img.caption || title}
                          loading="lazy"
                        />
                        {img.caption && <figcaption>{img.caption}</figcaption>}
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
