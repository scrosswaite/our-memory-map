import { useState, useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import './App.css';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { db } from './firebase'; // Import your Firestore database instance
import { collection, getDocs } from 'firebase/firestore';
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow
});

L.Marker.prototype.options.icon = DefaultIcon;

function App() {
  // This state will hold our array of memories from the database
  const [memories, setMemories] = useState([]);

  // Change the map's default starting position to Paris
  const initialPosition = [48.8584, 2.2945]; // Paris coordinates

  // This useEffect hook fetches the data when the component first loads
  useEffect(() => {
    const fetchMemories = async () => {
      const memoriesCollection = collection(db, "memories");
      const memoriesSnapshot = await getDocs(memoriesCollection);
      const memoriesList = memoriesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      console.log("Fetched Memories:", memoriesList); // Add this line back

      setMemories(memoriesList);
    };

    fetchMemories();
  }, []); // The empty array ensures this effect runs only once

  return (
    <MapContainer center={initialPosition} zoom={13}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      
      {/* Loop over the memories state and create a Marker for each one */}
      {memories.map(memory => {
        // This check ensures we only try to create a pin if the 
        // coordinates data actually exists for this memory.
        if (memory.coordinates) {
          return (
            <Marker
              key={memory.id}
              position={[memory.coordinates.latitude, memory.coordinates.longitude]}
            >
              <Popup>{memory.title}</Popup>
            </Marker>
          );
        }
        // If there are no coordinates, we return null so nothing is rendered
        return null;
      })}
    </MapContainer>
  );
}

export default App;