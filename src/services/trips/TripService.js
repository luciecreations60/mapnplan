import { APP_CONFIG } from '../../config/app.config.js';
import { TRIP_ACCENT_IDS } from '../../config/trip-accents.config.js';
import { createId } from '../../utils/id.js';
import { hasValidCoordinates } from '../../utils/map.js';
import { normalizeExternalUrl } from '../../utils/url.js';
import { createSavedPlace } from '../../utils/savedPlaces.js';
import { normalizeBookingOption } from '../../utils/bookingOptions.js';
import { normalizeCompanionSettings } from '../../utils/travelCompanion.js';
import { localStorageService } from '../storage/LocalStorageService.js';

const STORAGE_KEY = 'trip-library';
const OBSOLETE_TEST_STORAGE_KEYS = Object.freeze(['trips', 'seo-content-library']);
const CURRENT_TRIP_SCHEMA_VERSION = 21;

/**
 * Trip repository façade.
 *
 * All persistence, migrations, cloning and normalization rules are centralized
 * here. React pages operate on stable domain objects and remain independent
 * from the current LocalStorage implementation.
 */
class TripService {
  getAll() {
    OBSOLETE_TEST_STORAGE_KEYS.forEach((key) => localStorageService.remove(key));
    const storedTrips = localStorageService.get(STORAGE_KEY);

    if (Array.isArray(storedTrips)) {
      const normalizedTrips = storedTrips.map((trip) => this.#normalize(trip));
      localStorageService.set(STORAGE_KEY, normalizedTrips);
      return normalizedTrips;
    }

    localStorageService.set(STORAGE_KEY, []);
    return [];
  }

  getById(id) {
    return this.getAll().find((trip) => trip.id === id) || null;
  }

  create(payload) {
    const trips = this.getAll();
    const now = new Date().toISOString();
    const newTrip = this.#normalize({
      ...payload,
      id: createId('trip'),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      isFavorite: false,
      pinnedAt: null,
      itinerary: [],
      expenses: [],
      settlements: [],
      travelParty: [],
      checklist: [],
      checklistLists: [],
      reservations: [],
      documents: [],
      savedPlaces: [],
      savedPlaceLists: [],
      mapPointOrder: [],
      bookingOptions: [],
      notes: '',
      collaboration: null,
      companion: null,
      destinationCurrency: payload.destinationCurrency || payload.currency || APP_CONFIG.defaultCurrency,
    });

    localStorageService.set(STORAGE_KEY, [...trips, newTrip]);
    return newTrip;
  }

  update(id, patch) {
    let updatedTrip = null;
    const trips = this.getAll().map((trip) => {
      if (trip.id !== id) return trip;

      updatedTrip = this.#normalize({
        ...trip,
        ...patch,
        id,
        updatedAt: new Date().toISOString(),
      });
      return updatedTrip;
    });

    localStorageService.set(STORAGE_KEY, trips);
    return updatedTrip;
  }

  duplicate(id, name) {
    const sourceTrip = this.getById(id);
    if (!sourceTrip) return null;

    const now = new Date().toISOString();
    const participantIdMap = new Map(
      sourceTrip.travelParty.map((participant) => [participant.id, createId('traveller')]),
    );
    const duplicatedTravelParty = sourceTrip.travelParty.map((participant) => ({
      ...participant,
      id: participantIdMap.get(participant.id),
      createdAt: now,
    }));
    const duplicateTrip = this.#normalize({
      ...structuredClone(sourceTrip),
      id: createId('trip'),
      name: String(name || `${sourceTrip.name} copy`).trim(),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      isFavorite: false,
      pinnedAt: null,
      itinerary: sourceTrip.itinerary.map((day) => ({
        ...day,
        id: createId('day'),
        routePlan: this.#normalizeRoutePlan(null),
        items: day.items.map((item) => ({ ...item, id: createId('activity'), linkedReservationId: null, externalCalendarUid: '', completedAt: null, comments: [] })),
      })),
      travelParty: duplicatedTravelParty,
      expenses: sourceTrip.expenses.map((expense) => ({
        ...expense,
        id: createId('expense'),
        paidById: participantIdMap.get(expense.paidById) || duplicatedTravelParty[0]?.id || null,
        splitBetweenIds: (expense.splitBetweenIds || [])
          .map((participantId) => participantIdMap.get(participantId))
          .filter(Boolean),
        splitShares: (expense.splitShares || [])
          .map((share) => ({
            ...share,
            participantId: participantIdMap.get(share.participantId),
          }))
          .filter((share) => Boolean(share.participantId)),
        sourceActivityId: null,
        sourceActivitySeriesId: null,
      })),
      settlements: sourceTrip.settlements.map((settlement) => ({
        ...settlement,
        id: createId('settlement'),
        fromParticipantId: participantIdMap.get(settlement.fromParticipantId),
        toParticipantId: participantIdMap.get(settlement.toParticipantId),
        createdAt: now,
      })),
      checklist: sourceTrip.checklist.map((item) => ({ ...item, id: createId('check') })),
      checklistLists: (sourceTrip.checklistLists || []).map((list) => ({ ...list, id: createId('checklist-list') })),
      reservations: sourceTrip.reservations.map((reservation) => ({
        ...reservation,
        id: createId('reservation'),
        sourceActivityId: null,
        sourceActivitySeriesId: null,
        sourceBookingOptionId: null,
        createdAt: now,
        comments: [],
        externalCalendarUid: '',
      })),
      documents: sourceTrip.documents.map((document) => ({
        ...document,
        id: createId('document'),
        attachments: [],
        createdAt: now,
      })),
      savedPlaces: sourceTrip.savedPlaces.map((place) => ({
        ...place,
        id: createId('place'),
        status: place.status === 'visited' ? 'idea' : place.status,
        visitedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
      mapPointOrder: [],
      bookingOptions: sourceTrip.bookingOptions.map((option) => ({
        ...option,
        id: createId('booking-option'),
        status: option.status === 'booked' ? 'saved' : option.status,
        sourceActivityId: '',
        searchContextKey: '',
        bookedAt: null,
        createdAt: now,
        updatedAt: now,
      })),
      companion: {
        ...sourceTrip.companion,
        lastPreparedAt: null,
      },
      collaboration: {
        members: [{
          id: createId('member'),
          name: sourceTrip.collaboration?.members?.find((member) => member.role === 'owner')?.name
            || APP_CONFIG.localUserName,
          email: sourceTrip.collaboration?.members?.find((member) => member.role === 'owner')?.email || '',
          role: 'owner',
          addedAt: now,
        }],
        activityLog: [],
        share: { enabled: false, lastCreatedAt: null },
      },
    });

    localStorageService.set(STORAGE_KEY, [...this.getAll(), duplicateTrip]);
    return duplicateTrip;
  }


  toggleFavorite(id) {
    const trip = this.getById(id);
    if (!trip) return null;
    return this.update(id, { isFavorite: !trip.isFavorite });
  }

  togglePinned(id) {
    const trip = this.getById(id);
    if (!trip) return null;
    return this.update(id, { pinnedAt: trip.pinnedAt ? null : new Date().toISOString() });
  }

  archive(id) {
    return this.update(id, { archivedAt: new Date().toISOString() });
  }

  restore(id) {
    return this.update(id, { archivedAt: null });
  }

  replaceAll(trips) {
    if (!Array.isArray(trips)) {
      throw new Error('A trips array is required.');
    }

    const normalizedTrips = trips.map((trip) => this.#normalize(trip));
    localStorageService.set(STORAGE_KEY, normalizedTrips);
    return normalizedTrips;
  }

  remove(id) {
    const trips = this.getAll();
    const nextTrips = trips.filter((trip) => trip.id !== id);
    localStorageService.set(STORAGE_KEY, nextTrips);
    return nextTrips.length !== trips.length;
  }

  clearLocalTripData() {
    localStorageService.remove(STORAGE_KEY);
    OBSOLETE_TEST_STORAGE_KEYS.forEach((key) => localStorageService.remove(key));
    return this.getAll();
  }

  #normalize(trip) {
    const destinationCoordinates = this.#findDestinationCoordinates(trip);
    const collaboration = this.#normalizeCollaboration(trip.collaboration, trip);
    const travelParty = this.#normalizeTravelParty(
      trip.travelParty,
      collaboration,
      trip.travelers,
      trip.createdAt,
    );
    const expenses = this.#normalizeExpenses(trip.expenses, travelParty);
    const settlements = this.#normalizeSettlements(trip.settlements, travelParty);
    const checklist = this.#normalizeChecklist(trip.checklist);
    const checklistLists = this.#normalizeChecklistLists(trip.checklistLists, checklist);
    const itinerary = this.#normalizeItinerary(trip.itinerary);
    const reservations = this.#normalizeReservations(trip.reservations);
    const documents = this.#normalizeDocuments(trip.documents, reservations);
    const savedPlaces = this.#normalizeSavedPlaces(trip.savedPlaces);
    const savedPlaceLists = this.#normalizeSavedPlaceLists(trip.savedPlaceLists, savedPlaces);
    const bookingOptions = this.#normalizeBookingOptions(trip.bookingOptions, trip.currency);
    const companion = normalizeCompanionSettings(trip.companion);
    const calculatedSpent = expenses
      .reduce((sum, expense) => sum + expense.paidAmount, 0);
    const checklistCompleted = checklist.filter((item) => item.completed).length;

    return {
      schemaVersion: CURRENT_TRIP_SCHEMA_VERSION,
      id: trip.id,
      name: String(trip.name || 'Untitled trip').trim(),
      destination: String(trip.destination || '').trim(),
      destinationLatitude: destinationCoordinates.latitude,
      destinationLongitude: destinationCoordinates.longitude,
      country: String(trip.country || '').trim(),
      countryCode: String(trip.countryCode || '').trim().toUpperCase(),
      startDate: trip.startDate || '',
      endDate: trip.endDate || '',
      travelers: Math.max(1, Number(trip.travelers) || 1),
      currency: String(trip.currency || APP_CONFIG.defaultCurrency).trim().toUpperCase(),
      destinationCurrency: String(
        trip.destinationCurrency || trip.currency || APP_CONFIG.defaultCurrency,
      ).trim().toUpperCase(),
      budget: Math.max(0, Number(trip.budget) || 0),
      spent: expenses.length > 0
        ? calculatedSpent
        : Math.max(0, Number(trip.spent) || 0),
      checklistCompleted: checklist.length > 0
        ? checklistCompleted
        : Math.max(0, Number(trip.checklistCompleted) || 0),
      checklistTotal: checklist.length > 0
        ? checklist.length
        : Math.max(0, Number(trip.checklistTotal) || 0),
      accent: TRIP_ACCENT_IDS.includes(trip.accent) ? trip.accent : 'violet',
      coverImageUrl: normalizeExternalUrl(trip.coverImageUrl, { allowDataUrl: true }),
      summary: String(trip.summary || '').trim(),
      sourceTemplateId: trip.sourceTemplateId ? String(trip.sourceTemplateId) : null,
      sourceTemplateName: String(trip.sourceTemplateName || '').trim(),
      notes: String(trip.notes || ''),
      itinerary,
      expenses,
      settlements,
      travelParty,
      checklist,
      checklistLists,
      reservations,
      documents,
      savedPlaces,
      savedPlaceLists,
      mapPointOrder: Array.isArray(trip.mapPointOrder)
        ? [...new Set(trip.mapPointOrder.map(String).filter(Boolean))]
        : [],
      bookingOptions,
      companion,
      collaboration,
      archivedAt: trip.archivedAt || null,
      isFavorite: Boolean(trip.isFavorite),
      pinnedAt: trip.pinnedAt || null,
      createdAt: trip.createdAt || new Date().toISOString(),
      updatedAt: trip.updatedAt || new Date().toISOString(),
    };
  }

  #normalizeExpenses(expenses, travelParty) {
    if (!Array.isArray(expenses)) return [];

    const participantIds = new Set(travelParty.map((participant) => participant.id));
    const defaultParticipantId = travelParty.find((participant) => participant.isCurrentUser)?.id
      || travelParty[0]?.id
      || null;

    return expenses.map((expense) => {
      const amount = Math.max(0, Number(expense.amount) || 0);
      const legacyPaidAmount = expense.paid ? amount : 0;
      const paidAmount = Math.min(
        amount,
        Math.max(0, Number(expense.paidAmount ?? legacyPaidAmount) || 0),
      );
      const requestedSplitIds = Array.isArray(expense.splitBetweenIds)
        ? expense.splitBetweenIds.map(String).filter((id) => participantIds.has(id))
        : [];
      const splitBetweenIds = [...new Set(requestedSplitIds)];

      return {
        id: expense.id || createId('expense'),
        label: String(expense.label || 'Expense').trim(),
        category: String(expense.category || 'other').trim(),
        amount,
        paidAmount,
        date: expense.date || '',
        paid: amount > 0 && paidAmount >= amount,
        paidById: participantIds.has(expense.paidById)
          ? expense.paidById
          : defaultParticipantId,
        splitBetweenIds: splitBetweenIds.length > 0
          ? splitBetweenIds
          : travelParty.map((participant) => participant.id),
        splitShares: this.#normalizeSplitShares(
          expense.splitShares,
          splitBetweenIds.length > 0 ? splitBetweenIds : travelParty.map((participant) => participant.id),
          amount,
        ),
        notes: String(expense.notes || '').trim(),
        sourceActivityId: expense.sourceActivityId ? String(expense.sourceActivityId) : null,
        sourceActivitySeriesId: expense.sourceActivitySeriesId ? String(expense.sourceActivitySeriesId) : null,
      };
    });
  }

  #normalizeSplitShares(splitShares, splitBetweenIds, amount) {
    if (!Array.isArray(splitShares) || splitShares.length === 0) return [];
    const validIds = new Set(splitBetweenIds);
    const normalized = splitShares
      .map((share) => ({
        participantId: String(share?.participantId || ''),
        amount: Math.max(0, Number(share?.amount) || 0),
      }))
      .filter((share) => validIds.has(share.participantId));
    const total = normalized.reduce((sum, share) => sum + share.amount, 0);
    if (normalized.length === 0 || total <= 0 || amount <= 0) return [];
    let allocated = 0;
    return normalized.map((share, index) => {
      const shareAmount = index === normalized.length - 1
        ? Math.round((amount - allocated) * 100) / 100
        : Math.round(((share.amount / total) * amount) * 100) / 100;
      allocated = Math.round((allocated + shareAmount) * 100) / 100;
      return { participantId: share.participantId, amount: shareAmount };
    });
  }

  #normalizeTravelParty(travelParty, collaboration, travelerCount, createdAt) {
    const now = createdAt || new Date().toISOString();
    const source = Array.isArray(travelParty) ? travelParty : [];
    const collaborationMembers = Array.isArray(collaboration?.members)
      ? collaboration.members
      : [];
    const fallbackSource = source.length > 0
      ? source
      : collaborationMembers.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          isCurrentUser: member.role === 'owner',
          createdAt: member.addedAt,
        }));

    let participants = fallbackSource.map((participant, index) => ({
      id: participant.id || createId('traveller'),
      name: String(participant.name || `Traveler ${index + 1}`).trim(),
      email: String(participant.email || '').trim().toLowerCase(),
      isCurrentUser: Boolean(participant.isCurrentUser),
      createdAt: participant.createdAt || now,
    }));

    const desiredCount = Math.max(1, Number(travelerCount) || 1);
    while (participants.length < desiredCount) {
      participants.push({
        id: createId('traveller'),
        name: `Traveler ${participants.length + 1}`,
        email: '',
        isCurrentUser: false,
        createdAt: now,
      });
    }

    if (participants.length === 0) {
      participants = [{
        id: createId('traveller'),
        name: APP_CONFIG.localUserName,
        email: '',
        isCurrentUser: true,
        createdAt: now,
      }];
    }

    const currentUserIndex = participants.findIndex((participant) => participant.isCurrentUser);
    return participants.map((participant, index) => ({
      ...participant,
      isCurrentUser: currentUserIndex >= 0 ? index === currentUserIndex : index === 0,
    }));
  }

  #normalizeSettlements(settlements, travelParty) {
    if (!Array.isArray(settlements)) return [];
    const participantIds = new Set(travelParty.map((participant) => participant.id));

    return settlements
      .map((settlement) => ({
        id: settlement.id || createId('settlement'),
        fromParticipantId: participantIds.has(settlement.fromParticipantId)
          ? settlement.fromParticipantId
          : null,
        toParticipantId: participantIds.has(settlement.toParticipantId)
          ? settlement.toParticipantId
          : null,
        amount: Math.max(0, Number(settlement.amount) || 0),
        date: settlement.date || '',
        notes: String(settlement.notes || '').trim(),
        createdAt: settlement.createdAt || new Date().toISOString(),
      }))
      .filter((settlement) => (
        settlement.fromParticipantId
        && settlement.toParticipantId
        && settlement.fromParticipantId !== settlement.toParticipantId
        && settlement.amount > 0
      ));
  }

  #normalizeChecklist(checklist) {
    if (!Array.isArray(checklist)) return [];

    return checklist.map((item) => ({
      id: item.id || createId('check'),
      label: String(item.label || 'Checklist item').trim(),
      category: String(item.category || 'other').trim(),
      listTitle: String(item.listTitle || '').trim(),
      completed: Boolean(item.completed),
    }));
  }

  #normalizeChecklistLists(checklistLists, checklist) {
    const configured = Array.isArray(checklistLists) ? checklistLists : [];
    const inferredTitles = checklist.map((item) => item.listTitle).filter(Boolean);
    const titles = new Set();
    return [
      ...configured.map((list) => ({ id: list?.id || createId('checklist-list'), title: String(list?.title || '').trim() })),
      ...inferredTitles.map((title) => ({ id: createId('checklist-list'), title })),
    ].filter((list) => {
      const key = list.title.toLocaleLowerCase();
      if (!list.title || titles.has(key)) return false;
      titles.add(key);
      return true;
    });
  }

  #normalizeItinerary(itinerary) {
    if (!Array.isArray(itinerary)) return [];

    return itinerary
      .map((day) => ({
        id: day.id || createId('day'),
        date: day.date || '',
        title: String(day.title || '').trim(),
        routePlan: this.#normalizeRoutePlan(day.routePlan),
        items: Array.isArray(day.items)
          ? day.items.map((item) => ({
              id: item.id || createId('activity'),
              time: item.time || '',
              endTime: String(item.endTime || '').trim(),
              type: String(item.type || 'map').trim(),
              title: String(item.title || 'Activity').trim(),
              location: String(item.location || '').trim(),
              latitude: this.#normalizeLatitude(item.latitude),
              longitude: this.#normalizeLongitude(item.longitude),
              departureLocation: String(item.departureLocation || '').trim(),
              departureLatitude: this.#normalizeLatitude(item.departureLatitude),
              departureLongitude: this.#normalizeLongitude(item.departureLongitude),
              transportMode: ['walking', 'cycling', 'driving', 'transit', 'train', 'plane', 'ferry'].includes(item.transportMode)
                ? item.transportMode
                : '',
              durationMinutes: Math.max(0, Number(item.durationMinutes) || 0),
              estimatedCost: Math.max(0, Number(item.estimatedCost) || 0),
              routeDistanceKm: Math.max(0, Number(item.routeDistanceKm) || 0),
              vehicleType: String(item.vehicleType || '').trim(),
              fuelType: String(item.fuelType || '').trim(),
              consumptionLPer100Km: Math.max(0, Number(item.consumptionLPer100Km) || 0),
              fuelPricePerLiter: Math.max(0, Number(item.fuelPricePerLiter) || 0),
              tolls: Math.max(0, Number(item.tolls) || 0),
              includeWear: Boolean(item.includeWear),
              wearCostPerKm: Math.max(0, Number(item.wearCostPerKm) || 0),
              notes: String(item.notes || '').trim(),
              reminderMinutes: this.#normalizeReminderMinutes(item.reminderMinutes),
              externalCalendarUid: String(item.externalCalendarUid || '').trim(),
              completedAt: item.completedAt || null,
              comments: this.#normalizeComments(item.comments),
              linkedReservationId: item.linkedReservationId ? String(item.linkedReservationId) : null,
              seriesId: item.seriesId ? String(item.seriesId) : null,
              seriesIndex: Math.max(0, Number(item.seriesIndex) || 0),
              stayStartDate: String(item.stayStartDate || '').trim(),
              stayEndDate: String(item.stayEndDate || '').trim(),
              stayRole: ['single', 'checkin', 'stay', 'checkout'].includes(item.stayRole) ? item.stayRole : '',
              checkInTime: String(item.checkInTime || (item.type === 'hotel' ? item.time || '' : '')).trim(),
              checkOutTime: String(item.checkOutTime || '').trim(),
            }))
          : [],
      }))
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  #normalizeRoutePlan(routePlan) {
    const previousTimes = routePlan?.previousTimes && typeof routePlan.previousTimes === 'object'
      ? Object.fromEntries(
          Object.entries(routePlan.previousTimes)
            .map(([id, time]) => [String(id), String(time || '')])
            .slice(0, 100),
        )
      : {};

    return {
      mode: ['walking', 'cycling', 'driving', 'transit', 'train', 'plane', 'ferry'].includes(routePlan?.mode)
        ? routePlan.mode
        : 'walking',
      startStrategy: routePlan?.startStrategy === 'destination' ? 'destination' : 'firstActivity',
      startTime: /^\d{2}:\d{2}$/.test(String(routePlan?.startTime || ''))
        ? routePlan.startTime
        : '09:00',
      optimizedAt: routePlan?.optimizedAt || null,
      previousOrder: Array.isArray(routePlan?.previousOrder)
        ? routePlan.previousOrder.map(String).slice(0, 100)
        : [],
      previousTimes,
      manuallyOrderedAt: routePlan?.manuallyOrderedAt || null,
      estimatedDistanceKm: routePlan?.estimatedDistanceKm === null
        || routePlan?.estimatedDistanceKm === undefined
        ? null
        : Math.max(0, Number(routePlan.estimatedDistanceKm) || 0),
      estimatedTravelMinutes: routePlan?.estimatedTravelMinutes === null
        || routePlan?.estimatedTravelMinutes === undefined
        ? null
        : Math.max(0, Number(routePlan.estimatedTravelMinutes) || 0),
    };
  }

  #normalizeReservations(reservations) {
    if (!Array.isArray(reservations)) return [];

    return reservations.map((reservation) => ({
      id: reservation.id || createId('reservation'),
      type: ['flight', 'accommodation', 'transport', 'activity'].includes(reservation.type)
        ? reservation.type
        : 'activity',
      title: String(reservation.title || 'Reservation').trim(),
      provider: String(reservation.provider || '').trim(),
      confirmationNumber: String(reservation.confirmationNumber || '').trim(),
      startDate: reservation.startDate || '',
      startTime: reservation.startTime || '',
      endDate: reservation.endDate || '',
      endTime: reservation.endTime || '',
      location: String(reservation.location || '').trim(),
      status: ['confirmed', 'pending', 'cancelled'].includes(reservation.status)
        ? reservation.status
        : 'pending',
      amount: Math.max(0, Number(reservation.amount) || 0),
      url: normalizeExternalUrl(reservation.url),
      emailUrl: normalizeExternalUrl(reservation.emailUrl),
      latitude: this.#normalizeLatitude(reservation.latitude),
      longitude: this.#normalizeLongitude(reservation.longitude),
      notes: String(reservation.notes || '').trim(),
      reminderMinutes: this.#normalizeReminderMinutes(reservation.reminderMinutes),
      externalCalendarUid: String(reservation.externalCalendarUid || '').trim(),
      comments: this.#normalizeComments(reservation.comments),
      sourceActivityId: reservation.sourceActivityId ? String(reservation.sourceActivityId) : null,
      sourceActivitySeriesId: reservation.sourceActivitySeriesId ? String(reservation.sourceActivitySeriesId) : null,
      sourceBookingOptionId: reservation.sourceBookingOptionId ? String(reservation.sourceBookingOptionId) : null,
      createdAt: reservation.createdAt || new Date().toISOString(),
    }));
  }

  #normalizeDocuments(documents, reservations = []) {
    if (!Array.isArray(documents)) return [];
    const reservationIds = new Set(reservations.map((reservation) => reservation.id));

    return documents.map((document) => ({
      id: document.id || createId('document'),
      type: ['passport', 'identity', 'ticket', 'booking', 'insurance', 'other'].includes(document.type)
        ? document.type
        : 'other',
      title: String(document.title || 'Document').trim(),
      reference: String(document.reference || '').trim(),
      url: normalizeExternalUrl(document.url),
      expiryDate: document.expiryDate || '',
      notes: String(document.notes || '').trim(),
      linkedReservationId: reservationIds.has(String(document.linkedReservationId || ''))
        ? String(document.linkedReservationId)
        : null,
      attachments: Array.isArray(document.attachments)
        ? document.attachments.map((attachment) => ({
            id: String(attachment.id || createId('attachment')),
            name: String(attachment.name || 'attachment').trim(),
            type: String(attachment.type || 'application/octet-stream').trim(),
            size: Math.max(0, Number(attachment.size) || 0),
            lastModified: Math.max(0, Number(attachment.lastModified) || 0),
            createdAt: attachment.createdAt || new Date().toISOString(),
            updatedAt: attachment.updatedAt || attachment.createdAt || new Date().toISOString(),
          }))
        : [],
      createdAt: document.createdAt || new Date().toISOString(),
    }));
  }



  #normalizeBookingOptions(options, currency) {
    if (!Array.isArray(options)) return [];

    return options
      .map((option) => normalizeBookingOption(option, currency || APP_CONFIG.defaultCurrency))
      .filter((option) => option.title)
      .slice(0, 500);
  }

  #normalizeSavedPlaces(savedPlaces) {
    if (!Array.isArray(savedPlaces)) return [];

    return savedPlaces
      .map((place) => createSavedPlace(place))
      .filter((place) => place.name)
      .slice(0, 1000);
  }

  #normalizeSavedPlaceLists(savedPlaceLists, savedPlaces = []) {
    const source = Array.isArray(savedPlaceLists) ? savedPlaceLists : [];
    const used = savedPlaces.map((place) => place.list);
    return [...new Set([...source, ...used]
      .map((list) => String(list || '').trim())
      .filter(Boolean))]
      .slice(0, 100);
  }

  #normalizeReminderMinutes(value) {
    if (value === null || value === undefined || value === '') return null;
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return null;
    return Math.min(10080, Math.max(0, Math.round(minutes)));
  }

  #normalizeComments(comments) {
    if (!Array.isArray(comments)) return [];

    return comments
      .map((comment) => ({
        id: comment.id || createId('comment'),
        authorName: String(comment.authorName || APP_CONFIG.localUserName).trim(),
        message: String(comment.message || '').trim().slice(0, 500),
        createdAt: comment.createdAt || new Date().toISOString(),
      }))
      .filter((comment) => comment.message);
  }

  #normalizeCollaboration(collaboration, trip) {
    const now = new Date().toISOString();
    const sourceMembers = Array.isArray(collaboration?.members) ? collaboration.members : [];
    let members = sourceMembers.map((member) => ({
      id: member.id || createId('member'),
      name: String(member.name || APP_CONFIG.localUserName).trim(),
      email: String(member.email || '').trim().toLowerCase(),
      role: ['owner', 'editor', 'viewer'].includes(member.role) ? member.role : 'viewer',
      addedAt: member.addedAt || trip.createdAt || now,
    }));

    if (!members.some((member) => member.role === 'owner')) {
      members = [{
        id: createId('member'),
        name: APP_CONFIG.localUserName,
        email: '',
        role: 'owner',
        addedAt: trip.createdAt || now,
      }, ...members];
    }

    const activityLog = Array.isArray(collaboration?.activityLog)
      ? collaboration.activityLog.map((entry) => ({
          id: entry.id || createId('activity-log'),
          action: String(entry.action || 'tripUpdated').trim(),
          actorName: String(entry.actorName || APP_CONFIG.localUserName).trim(),
          entityType: String(entry.entityType || 'trip').trim(),
          entityId: String(entry.entityId || '').trim(),
          targetTitle: String(entry.targetTitle || '').trim(),
          createdAt: entry.createdAt || now,
        })).slice(0, 100)
      : [];

    return {
      members,
      activityLog,
      share: {
        enabled: Boolean(collaboration?.share?.enabled),
        lastCreatedAt: collaboration?.share?.lastCreatedAt || null,
      },
    };
  }


  #findDestinationCoordinates(trip) {
    const explicitLatitude = this.#normalizeLatitude(trip.destinationLatitude);
    const explicitLongitude = this.#normalizeLongitude(trip.destinationLongitude);
    if (hasValidCoordinates(explicitLatitude, explicitLongitude)) {
      return { latitude: explicitLatitude, longitude: explicitLongitude };
    }

    const candidates = [
      ...(Array.isArray(trip.itinerary)
        ? trip.itinerary.flatMap((day) => day.items || [])
        : []),
      ...(Array.isArray(trip.savedPlaces) ? trip.savedPlaces : []),
      ...(Array.isArray(trip.reservations) ? trip.reservations : []),
    ];
    const firstLocatedItem = candidates.find((item) => (
      hasValidCoordinates(item?.latitude, item?.longitude)
    ));

    return {
      latitude: firstLocatedItem ? this.#normalizeLatitude(firstLocatedItem.latitude) : null,
      longitude: firstLocatedItem ? this.#normalizeLongitude(firstLocatedItem.longitude) : null,
    };
  }

  #normalizeLatitude(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return hasValidCoordinates(number, 0) ? number : null;
  }

  #normalizeLongitude(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return hasValidCoordinates(0, number) ? number : null;
  }
}

export const tripService = new TripService();