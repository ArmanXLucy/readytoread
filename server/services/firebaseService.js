import { db, FieldValue } from '../config/firebase.js';
import { calculateMasteryMap } from './recommendationService.js';


/* =========================================================
   COMMON HELPERS
========================================================= */

export const now = () => new Date().toISOString();

export const userRef = (uid) =>
  db.collection('users').doc(String(uid));

export const prefRef = (uid) =>
  db.collection('user_preferences').doc(String(uid));

export const enrollmentRef = (uid, skillId) =>
  db.collection('enrollments').doc(`${uid}__${skillId}`);

export const progressRef = (uid, skillId, topicId, source) =>
  db
    .collection('topic_progress')
    .doc(
      `${uid}__${skillId}__${topicId}__${source}`
        .replaceAll('/', '_')
    );

export const activityRef = (uid, date) =>
  db.collection('activity_log').doc(`${uid}__${date}`);


/* =========================================================
   GET USER
========================================================= */

export async function getUser(uid) {
  const firebaseUid = String(uid);

  // First try document ID = Firebase UID
  const direct = await userRef(firebaseUid).get();

  if (direct.exists) {
    return {
      id: direct.id,
      ...direct.data()
    };
  }

  // Fallback for older users where the Firestore document
  // has an auto-generated ID and firebase_uid is a field.
  const q = await db
    .collection('users')
    .where(
      'firebase_uid',
      '==',
      firebaseUid
    )
    .limit(1)
    .get();

  if (q.empty) {
    return null;
  }

  return {
    id: q.docs[0].id,
    ...q.docs[0].data()
  };
}


/* =========================================================
   GET USER BY FIREBASE UID
========================================================= */

export async function getUserByFirebaseUid(firebaseUid) {
  const uid = String(firebaseUid);

  // Support:
  // users/{firebaseUid}
  const direct = await userRef(uid).get();

  if (direct.exists) {
    return {
      id: direct.id,
      ...direct.data()
    };
  }

  // Support:
  // users/{autoId} + firebase_uid field
  const q = await db
    .collection('users')
    .where(
      'firebase_uid',
      '==',
      uid
    )
    .limit(1)
    .get();

  if (q.empty) {
    return null;
  }

  return {
    id: q.docs[0].id,
    ...q.docs[0].data()
  };
}


/* =========================================================
   GET USER BY USERNAME
========================================================= */

export async function getUserByUsername(username) {
  const q = await db
    .collection('users')
    .where(
      'username',
      '==',
      String(
        username || ''
      ).toLowerCase()
    )
    .limit(1)
    .get();

  if (q.empty) {
    return null;
  }

  return {
    id: q.docs[0].id,
    ...q.docs[0].data()
  };
}


/* =========================================================
   GET USER BY EMAIL
========================================================= */

export async function getUserByEmail(email) {
  const normalizedEmail =
    String(email || '')
      .trim()
      .toLowerCase();

  // First search normalized email
  let q = await db
    .collection('users')
    .where(
      'email_normalized',
      '==',
      normalizedEmail
    )
    .limit(1)
    .get();

  if (!q.empty) {
    return {
      id: q.docs[0].id,
      ...q.docs[0].data()
    };
  }

  // Fallback to original email
  q = await db
    .collection('users')
    .where(
      'email',
      '==',
      email
    )
    .limit(1)
    .get();

  if (q.empty) {
    return null;
  }

  return {
    id: q.docs[0].id,
    ...q.docs[0].data()
  };
}


/* =========================================================
   CREATE FIREBASE USER
========================================================= */

export async function createFirebaseUser(data) {
  const ref =
    db.collection('users').doc();

  await ref.set({
    ...data,

    created_at:
      now(),

    updated_at:
      now(),

    email_normalized:
      String(
        data.email || ''
      )
        .trim()
        .toLowerCase()
  });

  return ref.id;
}


/* =========================================================
   UPDATE USER
========================================================= */

export async function updateUser(uid, patch) {
  const firebaseUid =
    String(uid);

  const existingUser =
    await getUserByFirebaseUid(
      firebaseUid
    );

  const ref = existingUser
    ? db
        .collection('users')
        .doc(existingUser.id)
    : userRef(firebaseUid);

  await ref.set(
    {
      ...patch,

      firebase_uid:
        firebaseUid,

      updated_at:
        now()
    },
    {
      merge: true
    }
  );
}


/* =========================================================
   USER PREFERENCES
========================================================= */

export async function getPreferences(uid) {
  const ref =
    prefRef(uid);

  let s =
    await ref.get();

  if (!s.exists) {
    await ref.set({
      user_id:
        String(uid),

      theme:
        'light',

      reminders:
        true,

      streak_alerts:
        true,

      product_updates:
        true,

      auto_next:
        true,

      show_completed:
        true,

      learning_goal:
        '',

      hours_per_week:
        0,

      learning_style:
        '',

      learning_focus:
        ''
    });

    s =
      await ref.get();
  }

  return {
    id:
      s.id,

    ...s.data()
  };
}


export async function updatePreferences(
  uid,
  patch
) {
  await prefRef(uid).set(
    {
      ...patch,

      user_id:
        String(uid)
    },
    {
      merge: true
    }
  );
}



/* =========================================================
   NOTIFICATIONS
   Persistent Firestore notifications for students + admins
========================================================= */

export async function createNotification({
  userId = null,
  audience = 'user',
  type = 'system',
  title = '',
  message = '',
  link = '/dashboard',
  icon = 'bell'
} = {}) {
  const cleanAudience =
    audience === 'admin' ? 'admin' : 'user';

  const ref =
    db.collection('notifications').doc();

  await ref.set({
    user_id:
      cleanAudience === 'user' && userId != null
        ? String(userId)
        : null,

    audience: cleanAudience,
    type: String(type || 'system'),
    title: String(title || 'Notification').trim(),
    message: String(message || '').trim(),
    link: String(link || '/dashboard'),
    icon: String(icon || 'bell'),
    read: false,
    created_at: now()
  });

  return ref.id;
}


export async function getNotifications(
  uid,
  isAdmin = false,
  limit = 50
) {
  const audience =
    isAdmin ? 'admin' : 'user';

  const requestedLimit =
    Number.isFinite(Number(limit))
      ? Math.max(1, Math.min(100, Number(limit)))
      : 50;

  const ref =
    db.collection('notifications');

  const q =
    isAdmin
      ? await ref
          .where('audience', '==', 'admin')
          .limit(requestedLimit)
          .get()
      : await ref
          .where('user_id', '==', String(uid))
          .limit(requestedLimit)
          .get();

  const notifications =
    q.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

  notifications.sort(
    (a, b) =>
      String(b.created_at || '').localeCompare(
        String(a.created_at || '')
      )
  );

  return notifications;
}


export async function markNotificationRead(
  notificationId,
  uid,
  isAdmin = false
) {
  const ref =
    db.collection('notifications').doc(String(notificationId));

  const doc =
    await ref.get();

  if (!doc.exists) {
    return false;
  }

  const data =
    doc.data() || {};

  const allowed =
    isAdmin
      ? data.audience === 'admin'
      : data.audience === 'user' &&
        String(data.user_id || '') === String(uid);

  if (!allowed) {
    return false;
  }

  await ref.set(
    {
      read: true,
      read_at: now()
    },
    { merge: true }
  );

  return true;
}


export async function clearAllNotifications(
  uid,
  isAdmin = false
) {
  const notifications =
    await getNotifications(uid, isAdmin, 100);

  if (!notifications.length) {
    return 0;
  }

  let count = 0;

  for (let start = 0; start < notifications.length; start += 450) {
    const batch = db.batch();
    const chunk = notifications.slice(start, start + 450);

    chunk.forEach((notification) => {
      batch.delete(db.collection('notifications').doc(notification.id));
      count++;
    });

    if (chunk.length) {
      await batch.commit();
    }
  }

  return count;
}


export async function markAllNotificationsRead(
  uid,
  isAdmin = false
) {
  const notifications =
    await getNotifications(uid, isAdmin, 100);

  if (!notifications.length) {
    return 0;
  }

  let count = 0;

  for (
    let start = 0;
    start < notifications.length;
    start += 450
  ) {
    const batch =
      db.batch();

    const chunk =
      notifications.slice(start, start + 450);

    chunk.forEach(notification => {
      if (!notification.read) {
        batch.set(
          db.collection('notifications').doc(notification.id),
          {
            read: true,
            read_at: now()
          },
          { merge: true }
        );
        count++;
      }
    });

    if (chunk.some(n => !n.read)) {
      await batch.commit();
    }
  }

  return count;
}


/* =========================================================
   CREATE SUPPORT TICKET
   STUDENT -> FIRESTORE
========================================================= */

export async function createSupportTicket(
  uid,
  topic,
  message,
  priority = 'normal'
) {
  const rawId =
    String(uid);

  let user =
    await getUser(rawId);

  if (!user) {
    user =
      await getUserByFirebaseUid(
        rawId
      );
  }

  const userId =
    user?.id ||
    rawId;

  const firebaseUid =
    user?.firebase_uid ||
    rawId;

  const ref =
    db
      .collection(
        'support_tickets'
      )
      .doc();

  await ref.set({

    user_id:
      userId,

    firebase_uid:
      firebaseUid,

    user_name:
      user?.name ||
      user?.display_name ||
      '',

    user_email:
      user?.email ||
      '',

    topic:
      String(
        topic ||
        'General help'
      ).trim(),

    message:
      String(
        message ||
        ''
      ).trim(),

    priority:
      String(
        priority ||
        'normal'
      )
        .trim()
        .toLowerCase(),

    status:
      'open',

    admin_message:
      '',

    approved_by:
      '',

    created_at:
      now(),

    updated_at:
      now(),

    responded_at:
      null
  });

  return ref.id;
}


/* =========================================================
   GET ALL SUPPORT TICKETS
   ADMIN PANEL
========================================================= */

export async function getSupportTickets() {
  const q =
    await db
      .collection(
        'support_tickets'
      )
      .get();

  const tickets = [];

  for (
    const doc of q.docs
  ) {
    const data =
      doc.data() || {};

    // Older support records might not contain
    // user name/email, so resolve them when possible.
    if (
      (
        !data.user_name ||
        !data.user_email
      ) &&
      data.user_id
    ) {
      const user =
        await getUser(
          data.user_id
        );

      if (user) {
        data.user_name =
          data.user_name ||
          user.name ||
          user.display_name ||
          '';

        data.user_email =
          data.user_email ||
          user.email ||
          '';
      }
    }

    tickets.push({
      id:
        doc.id,

      ...data
    });
  }

  // Newest first
  tickets.sort(
    (a, b) =>
      String(
        b.created_at || ''
      ).localeCompare(
        String(
          a.created_at || ''
        )
      )
  );

  return tickets;
}


/* =========================================================
   GET SUPPORT TICKETS FOR CURRENT STUDENT
========================================================= */

export async function getSupportTicketsForUser(
  uid
) {
  const userId =
    String(uid);

  const user =
    await getUser(userId);

  const ids =
    new Set([
      userId,
      ...(user?.firebase_uid
        ? [String(user.firebase_uid)]
        : [])
    ]);

  const ticketsById =
    new Map();

  for (const id of ids) {
    const q =
      await db
        .collection(
          'support_tickets'
        )
        .where(
          'user_id',
          '==',
          id
        )
        .get();

    q.docs.forEach((doc) => {
      ticketsById.set(
        doc.id,
        {
          id: doc.id,
          ...doc.data()
        }
      );
    });
  }

  const tickets =
    [...ticketsById.values()];

  tickets.sort(
    (a, b) =>
      String(
        b.created_at || ''
      ).localeCompare(
        String(
          a.created_at || ''
        )
      )
  );

  return tickets;
}


/* =========================================================
   GET SINGLE SUPPORT TICKET
========================================================= */

export async function getSupportTicket(
  ticketId
) {
  const doc =
    await db
      .collection(
        'support_tickets'
      )
      .doc(
        String(ticketId)
      )
      .get();

  if (!doc.exists) {
    return null;
  }

  return {
    id:
      doc.id,

    ...doc.data()
  };
}


/* =========================================================
   UPDATE SUPPORT TICKET
========================================================= */

export async function updateSupportTicket(
  ticketId,
  patch = {}
) {
  await db
    .collection(
      'support_tickets'
    )
    .doc(
      String(ticketId)
    )
    .set(
      {
        ...patch,

        updated_at:
          now()
      },
      {
        merge: true
      }
    );

  return getSupportTicket(
    ticketId
  );
}


/* =========================================================
   APPROVE SUPPORT TICKET
   ADMIN -> STUDENT MESSAGE
========================================================= */

export async function approveSupportTicket(
  ticketId,
  adminMessage,
  adminUserId
) {
  const message =
    String(
      adminMessage || ''
    ).trim();

  if (!message) {
    throw new Error(
      'Please enter an admin message before approving the request.'
    );
  }

  if (
    message.length >
    2000
  ) {
    throw new Error(
      'Admin message must be 2000 characters or less.'
    );
  }

  return updateSupportTicket(
    ticketId,
    {
      status:
        'approved',

      admin_message:
        message,

      approved_by:
        String(
          adminUserId || ''
        ),

      responded_at:
        now()
    }
  );
}


/* =========================================================
   DELETE SUPPORT TICKET
========================================================= */

export async function deleteSupportTicket(
  ticketId
) {
  const ref =
    db
      .collection(
        'support_tickets'
      )
      .doc(
        String(ticketId)
      );

  const doc =
    await ref.get();

  if (!doc.exists) {
    return false;
  }

  await ref.delete();

  return true;
}


/* =========================================================
   ENROLLMENTS
========================================================= */

export async function getEnrollment(
  uid,
  skillId
) {
  const s =
    await enrollmentRef(
      uid,
      skillId
    ).get();

  if (!s.exists) {
    return null;
  }

  return {
    id:
      s.id,

    ...s.data()
  };
}


export async function getEnrollments(
  uid
) {
  const q =
    await db
      .collection(
        'enrollments'
      )
      .where(
        'user_id',
        '==',
        String(uid)
      )
      .get();

  return q.docs.map(
    (d) => ({
      id:
        d.id,

      ...d.data()
    })
  );
}


export async function saveEnrollment(
  uid,
  skillId,
  patch,
  create = false
) {
  const ref =
    enrollmentRef(
      uid,
      skillId
    );

  const base = {
    user_id:
      String(uid),

    skill_id:
      skillId,

    updated_at:
      now(),

    ...patch
  };

  if (create) {
    base.started_at =
      now();
  }

  await ref.set(
    base,
    {
      merge: true
    }
  );
}


/* =========================================================
   MASTERED TOPICS
========================================================= */

export async function getMastered(
  uid,
  skillId
) {
  const progress = await getProgress(
    uid,
    skillId
  );

  const topicIds = [
    ...new Set(
      progress
        .map(p => p.topic_id)
        .filter(Boolean)
    )
  ];

  const mastery =
    calculateMasteryMap(
      progress,
      skillId,
      topicIds
    );

  return new Set(
    topicIds.filter(
      topicId =>
        Number(
          mastery[topicId] || 0
        ) >= 90
    )
  );
}


/* =========================================================
   PROGRESS
========================================================= */

export async function getProgress(
  uid,
  skillId
) {
  const q =
    await db
      .collection(
        'topic_progress'
      )
      .where(
        'user_id',
        '==',
        String(uid)
      )
      .where(
        'skill_id',
        '==',
        skillId
      )
      .get();

  return q.docs
    .map(
      d => ({
        id:
          d.id,

        ...d.data()
      })
    )
    .sort(
      (a, b) =>
        String(
          b.updated_at || ''
        ).localeCompare(
          String(
            a.updated_at || ''
          )
        )
    );
}


/* =========================================================
   UPSERT PROGRESS
========================================================= */

export async function upsertProgress(
  uid,
  skillId,
  topicId,
  mastered,
  quizScore,
  source
) {
  await progressRef(
    uid,
    skillId,
    topicId,
    source
  ).set(
    {
      user_id:
        String(uid),

      learnoraUserId:
        String(uid),

      firebaseUid:
        String(uid),

      skill_id:
        skillId,

      topic_id:
        topicId,

      mastered:
        Boolean(
          mastered
        ),

      quiz_score:
        Number(
          quizScore || 0
        ),

      source,

      updated_at:
        now()
    },
    {
      merge: true
    }
  );
}


/* =========================================================
   CLEAR BASELINE
========================================================= */

export async function clearBaseline(
  uid,
  skillId
) {
  const q =
    await db
      .collection(
        'topic_progress'
      )
      .where(
        'user_id',
        '==',
        String(uid)
      )
      .where(
        'skill_id',
        '==',
        skillId
      )
      .where(
        'source',
        '==',
        'level_baseline'
      )
      .get();

  if (q.empty) {
    return;
  }

  const batch =
    db.batch();

  q.docs.forEach(
    (d) =>
      batch.delete(
        d.ref
      )
  );

  await batch.commit();
}


/* =========================================================
   ACTIVITY
========================================================= */

export async function recordActivity(
  uid
) {
  const date =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );

  await activityRef(
    uid,
    date
  ).set(
    {
      user_id:
        String(uid),

      activity_date:
        date
    },
    {
      merge: true
    }
  );
}


/* =========================================================
   STREAK
========================================================= */

export async function streakInfo(
  uid
) {
  const q =
    await db
      .collection(
        'activity_log'
      )
      .where(
        'user_id',
        '==',
        String(uid)
      )
      .get();

  const dates = [
    ...new Set(
      q.docs
        .map(
          d =>
            d.data()
              .activity_date
        )
        .filter(Boolean)
    )
  ].sort();

  if (!dates.length) {
    return {
      current_streak:
        0,

      longest_streak:
        0,

      active_dates:
        [],

      total_active_days:
        0
    };
  }

  const set =
    new Set(dates);

  const day =
    new Date();

  day.setUTCHours(
    0,
    0,
    0,
    0
  );

  let current =
    0;

  let cursor =
    new Date(day);

  if (
    !set.has(
      cursor
        .toISOString()
        .slice(0, 10)
    )
  ) {
    cursor.setUTCDate(
      cursor.getUTCDate() - 1
    );
  }

  while (
    set.has(
      cursor
        .toISOString()
        .slice(0, 10)
    )
  ) {
    current++;

    cursor.setUTCDate(
      cursor.getUTCDate() - 1
    );
  }

  let longest =
    1;

  let run =
    1;

  for (
    let i = 1;
    i < dates.length;
    i++
  ) {
    const a =
      new Date(
        dates[i - 1] +
        'T00:00:00Z'
      );

    const b =
      new Date(
        dates[i] +
        'T00:00:00Z'
      );

    if (
      (b - a) /
        86400000 ===
      1
    ) {
      run++;
    } else {
      run = 1;
    }

    longest =
      Math.max(
        longest,
        run
      );
  }

  return {
    current_streak:
      current,

    longest_streak:
      longest,

    active_dates:
      dates.slice(-84),

    total_active_days:
      dates.length
  };
}


/* =========================================================
   ALL NORMAL USERS
========================================================= */

export async function allUsers() {
  const q =
    await db
      .collection(
        'users'
      )
      .where(
        'is_admin',
        '==',
        false
      )
      .get();

  return q.docs.map(
    d => ({
      id:
        d.id,

      ...d.data()
    })
  );
}


/* =========================================================
   ENSURE SKILL DOCUMENTS
========================================================= */

export async function ensureSkillDocuments(
  skills
) {
  const batch =
    db.batch();

  for (
    const [
      id,
      s
    ] of Object.entries(
      skills
    )
  ) {
    batch.set(
      db
        .collection(
          'skills'
        )
        .doc(id),

      {
        skill_id:
          id,

        ...s,

        updated_at:
          now()
      },

      {
        merge: true
      }
    );
  }

  await batch.commit();
}