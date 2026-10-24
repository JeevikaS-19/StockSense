import React from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, buttonPrimary } from '../components/common/Field.tsx';

export const NotFoundPage: React.FC = () => (
  <EmptyState
    title="This page does not exist"
    text="The link may be out of date. Use the sidebar to find what you need."
    action={
      <Link to="/" className={buttonPrimary}>
        Go to the dashboard
      </Link>
    }
  />
);
