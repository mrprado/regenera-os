// ATLAS placeholder: a dark canvas in the map's own frame while the spatial application loads, never a blank page.
import s from "@/components/skeleton.module.css";

export default function AtlasLoading() {
  return <div className={s.map} aria-busy="true" aria-label="Loading Atlas"><span className={s.mapLabel}>Atlas · establishing map</span></div>;
}
