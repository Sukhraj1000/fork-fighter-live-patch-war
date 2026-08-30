import { z } from 'zod'

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9:_-]*$/)

export const NonNegativeIntegerSchema = z.number().int().min(0)
export const PositiveIntegerSchema = z.number().int().positive()
export const FiniteNumberSchema = z.number().finite()
export const UnitIntervalSchema = FiniteNumberSchema.min(0).max(1)

export const Vector2Schema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
  })
  .strict()

export const RectangleSchema = z
  .object({
    x: FiniteNumberSchema,
    y: FiniteNumberSchema,
    width: FiniteNumberSchema.positive(),
    height: FiniteNumberSchema.positive(),
  })
  .strict()

export type Vector2 = z.infer<typeof Vector2Schema>
export type Rectangle = z.infer<typeof RectangleSchema>
