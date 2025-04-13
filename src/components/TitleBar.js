import React from 'react';
import styled from 'styled-components';

const TitleBarContainer = styled.div`
  -webkit-app-region: drag;
  height: 28px;
  background-color: var(--background-color);
  display: flex;
  align-items: center;
  padding-left: 80px; // Space for traffic light buttons
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
`;

const TitleBar = () => {
  return <TitleBarContainer />;
};

export default TitleBar; 