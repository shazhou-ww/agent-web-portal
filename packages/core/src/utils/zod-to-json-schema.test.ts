import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { blob, inputBlob, outputBlob } from "../blob.ts";
import { zodToJsonSchema } from "./zod-to-json-schema.ts";

describe("zodToJsonSchema with blob support", () => {
  test("converts input blob schema to object with url and contentType", () => {
    const schema = inputBlob({ description: "PDF document", mimeType: "application/pdf" });
    const jsonSchema = zodToJsonSchema(schema);

    // Input blobs are objects with { url: string, contentType?: string }
    expect(jsonSchema).toEqual({
      type: "object",
      properties: {
        url: { type: "string", minLength: undefined, maxLength: undefined },
        contentType: { type: "string", minLength: undefined, maxLength: undefined },
      },
      required: ["url"],
    });
  });

  test("converts output blob schema to object with url and accept", () => {
    const schema = outputBlob({ description: "Generated image", accept: "image/png" });
    const jsonSchema = zodToJsonSchema(schema);

    // Output blobs are objects with { url: string, accept?: string }
    expect(jsonSchema).toEqual({
      type: "object",
      properties: {
        url: { type: "string", minLength: undefined, maxLength: undefined },
        accept: { type: "string", minLength: undefined, maxLength: undefined },
      },
      required: ["url"],
    });
  });

  test("handles object schema with input blob fields", () => {
    const schema = z.object({
      document: inputBlob({ description: "PDF document", mimeType: "application/pdf" }),
      name: z.string(),
      count: z.number(),
    });

    const jsonSchema = zodToJsonSchema(schema);

    expect(jsonSchema).toEqual({
      type: "object",
      properties: {
        document: {
          type: "object",
          properties: {
            url: { type: "string", minLength: undefined, maxLength: undefined },
            contentType: { type: "string", minLength: undefined, maxLength: undefined },
          },
          required: ["url"],
        },
        name: { type: "string", minLength: undefined, maxLength: undefined },
        count: { type: "number" },
      },
      required: ["document", "name", "count"],
    });
  });

  test("handles optional blob fields", () => {
    const schema = z.object({
      document: inputBlob({ description: "PDF document", mimeType: "application/pdf" }).optional(),
      name: z.string(),
    });

    const jsonSchema = zodToJsonSchema(schema);

    expect(jsonSchema).toEqual({
      type: "object",
      properties: {
        document: {
          type: "object",
          properties: {
            url: { type: "string", minLength: undefined, maxLength: undefined },
            contentType: { type: "string", minLength: undefined, maxLength: undefined },
          },
          required: ["url"],
        },
        name: { type: "string", minLength: undefined, maxLength: undefined },
      },
      required: ["name"],
    });
  });

  test("handles array of blobs", () => {
    const schema = z.object({
      images: z.array(inputBlob({ description: "Image", mimeType: "image/*" })),
    });

    const jsonSchema = zodToJsonSchema(schema);

    expect(jsonSchema).toEqual({
      type: "object",
      properties: {
        images: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", minLength: undefined, maxLength: undefined },
              contentType: { type: "string", minLength: undefined, maxLength: undefined },
            },
            required: ["url"],
          },
        },
      },
      required: ["images"],
    });
  });

  test("legacy blob() generates input blob format", () => {
    const schema = blob();
    const jsonSchema = zodToJsonSchema(schema);

    // Legacy blob() defaults to input blob format
    expect(jsonSchema).toEqual({
      type: "object",
      properties: {
        url: { type: "string", minLength: undefined, maxLength: undefined },
        contentType: { type: "string", minLength: undefined, maxLength: undefined },
      },
      required: ["url"],
    });
  });
});
