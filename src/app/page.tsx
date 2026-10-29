import ExtractoApp from "@/components/extracto-app";
import { MAX_UPLOAD_MB } from "@/lib/files";

export default function Home() {
  return <ExtractoApp maxUploadMB={MAX_UPLOAD_MB} />;
}
