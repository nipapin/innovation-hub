import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"

const PREFIX = "ffworks/kotliar/"

export async function deleteKotliarObject(key: string): Promise<void> {
  if (!key.startsWith(PREFIX)) return
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: key }),
  )
}

export async function deleteKotliarObjects(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => deleteKotliarObject(key).catch(() => undefined)))
}
