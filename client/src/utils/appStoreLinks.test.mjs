import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAY_STORE_URL, APP_STORE_URL } from './appStoreLinks.js'

test('Google Play link opens the Indo OEE listing (com.hqepl.indo_oee) over https', () => {
  const url = new URL(PLAY_STORE_URL)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'play.google.com')
  assert.equal(url.pathname, '/store/apps/details')
  assert.equal(url.searchParams.get('id'), 'com.hqepl.indo_oee')
})

test('App Store link opens the Indo OEE listing (id6825675790) over https', () => {
  const url = new URL(APP_STORE_URL)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'apps.apple.com')
  assert.match(url.pathname, /\/id6825675790$/)
})
